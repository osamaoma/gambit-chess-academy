/**
 * Gemini 2.5 Flash client.
 *
 * Thin on purpose: build a request, send it, hand the body to the parser.
 * Prompt wording lives in {@link ./prompt-builder}, validation in
 * {@link ./response-parser}, and the retry policy in {@link ./retry} — this
 * file only knows how to talk to the API.
 *
 * ── Where the key belongs ──────────────────────────────────────────────────
 * An API key in a browser bundle is a public API key. Anyone can read it and
 * spend your quota. In production this service should run on YOUR server, with
 * the browser calling your endpoint; the `transport` hook exists exactly so the
 * browser build can post to that proxy instead of to Google directly. The key
 * is never read from a global or hardcoded — it must be passed in.
 */

import { errorFromStatus, GeminiError } from './errors';
import { GeminiResponseBody } from './response-parser';

/** Swappable so tests need no network and the browser can use a proxy. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiConfig {
  /** Required. Supply from a server-side environment variable. */
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  /** Higher = more varied wording. Kept moderate so notes stay accurate. */
  readonly temperature: number;
  /** Hard cap on generated tokens; ~80 words needs very few. */
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  /**
   * When true, the key is sent as an `x-goog-api-key` header instead of a
   * query parameter, so it never lands in a URL (and therefore never in access
   * logs). Default true.
   */
  readonly useHeaderAuth: boolean;
}

export const DEFAULT_GEMINI_CONFIG: Omit<GeminiConfig, 'apiKey'> = {
  model: 'gemini-2.5-flash',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  temperature: 0.85,
  maxOutputTokens: 200,
  timeoutMs: 10_000,
  useHeaderAuth: true,
};

export interface GenerateRequest {
  readonly systemInstruction: string;
  readonly userPrompt: string;
}

export class GeminiService {
  private readonly config: GeminiConfig;

  constructor(config: Partial<GeminiConfig> & { apiKey: string }, private readonly transport: Transport = defaultTransport) {
    if (!config.apiKey) {
      throw new GeminiError('config', 'A Gemini API key is required. Supply it from server-side configuration.');
    }
    this.config = { ...DEFAULT_GEMINI_CONFIG, ...config };
  }

  /** One generation call. Throws {@link GeminiError}; retries are the caller's job. */
  async generate(request: GenerateRequest): Promise<string> {
    const { config } = this;
    const url = `${config.baseUrl}/models/${config.model}:generateContent`
      + (config.useHeaderAuth ? '' : `?key=${encodeURIComponent(config.apiKey)}`);

    const body = {
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: request.userPrompt }] }],
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        // One candidate: we want a note, not a menu.
        candidateCount: 1,
      },
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.useHeaderAuth) headers['x-goog-api-key'] = config.apiKey;

    // AbortController stops a hung request holding a review open forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    let response: Response;
    try {
      response = await this.transport(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as { name?: string })?.name === 'AbortError';
      throw new GeminiError('network', aborted ? `Request timed out after ${config.timeoutMs}ms.` : String(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw errorFromStatus(response.status, await safeText(response));
    }

    let parsed: GeminiResponseBody;
    try {
      parsed = (await response.json()) as GeminiResponseBody;
    } catch {
      throw new GeminiError('malformed', 'Response body was not valid JSON.');
    }
    return extractOrThrow(parsed);
  }
}

/** Kept separate so the service stays testable without importing the parser's config. */
function extractOrThrow(body: GeminiResponseBody): string {
  const candidate = body.candidates?.[0];
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) throw new GeminiError('blocked', `Blocked by safety filters: ${blocked}`);
  if (!candidate) throw new GeminiError('blocked', 'No candidates returned.');
  const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) throw new GeminiError('malformed', 'Empty note returned.');
  return text;
}

async function safeText(response: Response): Promise<string> {
  try { return await response.text(); } catch { return ''; }
}

const defaultTransport: Transport = (url, init) => {
  if (typeof fetch !== 'function') {
    throw new GeminiError('config', 'No global fetch available; supply a transport.');
  }
  return fetch(url, init);
};
