/**
 * Module 7 — ExplanationGenerator, backed by Gemini 2.5 Flash.
 *
 * Composition only: cache → prompt → service (with retry) → parser. Each of
 * those is independently testable and independently replaceable, which is what
 * lets the model, the wording rules or the cache change without touching the
 * others.
 *
 * The division of labour is absolute: this engine has already decided what is
 * true about the move, and the model only chooses the words. Nothing the model
 * returns can change a classification, an arrow or a highlight — by the time it
 * is called, those are fixed.
 */

import type { Explanation, ExplanationGenerator, ExplanationInput } from '../types';
import { ExplanationCache, hashKey, LruCache } from './cache';
import { GeminiError } from './errors';
import { GeminiService } from './gemini-service';
import {
  buildSystemInstruction,
  buildUserPrompt,
  DEFAULT_PROMPT_CONFIG,
  promptCacheKeyInput,
  PromptConfig,
} from './prompt-builder';
import { DEFAULT_PARSER_CONFIG, parseExplanation, ParserConfig } from './response-parser';
import { DEFAULT_RETRY, RetryConfig, Sleeper, withRetry } from './retry';

export interface GeminiGeneratorOptions {
  readonly prompt?: PromptConfig;
  readonly parser?: ParserConfig;
  readonly retry?: RetryConfig;
  readonly cache?: ExplanationCache<string>;
  /**
   * Used when the model cannot be reached or keeps returning unusable text.
   * A review that renders without a note is far better than one that fails.
   * Returning null (the default) leaves the note empty and lets the pipeline
   * decide.
   */
  readonly fallback?: (input: ExplanationInput) => string | null;
  /** Observability hooks — no logger dependency in this package. */
  readonly onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  readonly onError?: (error: unknown, input: ExplanationInput) => void;
  readonly sleep?: Sleeper;
}

export class GeminiExplanationGenerator implements ExplanationGenerator {
  private readonly cache: ExplanationCache<string>;
  private readonly promptConfig: PromptConfig;
  private readonly parserConfig: ParserConfig;
  private readonly retryConfig: RetryConfig;
  /** Requests in flight, so a double-click cannot generate the same note twice. */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly service: GeminiService, private readonly options: GeminiGeneratorOptions = {}) {
    this.cache = options.cache ?? new LruCache<string>(500);
    this.promptConfig = options.prompt ?? DEFAULT_PROMPT_CONFIG;
    this.parserConfig = options.parser ?? DEFAULT_PARSER_CONFIG;
    this.retryConfig = options.retry ?? DEFAULT_RETRY;
  }

  async generate(input: ExplanationInput): Promise<Explanation> {
    const key = hashKey(promptCacheKeyInput(input));

    const cached = this.cache.get(key);
    if (cached) return { summary: cached, source: 'cache' };

    // Coalesce concurrent identical requests onto one call.
    const existing = this.inFlight.get(key);
    if (existing) return { summary: await existing, source: 'cache' };

    const task = this.requestNote(input);
    this.inFlight.set(key, task);
    try {
      const summary = await task;
      this.cache.set(key, summary);
      return { summary, source: 'model' };
    } catch (error) {
      this.options.onError?.(error, input);
      const fallback = this.options.fallback?.(input);
      if (fallback) return { summary: fallback, source: 'fallback' };
      throw error instanceof GeminiError
        ? error
        : new GeminiError('malformed', `Explanation generation failed: ${String(error)}`);
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** One note: prompt, call with retry, validate. */
  private async requestNote(input: ExplanationInput): Promise<string> {
    const systemInstruction = buildSystemInstruction(this.promptConfig);
    const userPrompt = buildUserPrompt(input, this.promptConfig);

    return withRetry(
      async () => {
        const raw = await this.service.generate({ systemInstruction, userPrompt });
        // Validation failures are retryable in practice — a second sample
        // usually obeys the rules — so they are raised inside the retry block.
        const parsed = parseExplanation(raw, this.parserConfig);
        return parsed.summary;
      },
      this.retryConfig,
      this.options.sleep,
      this.options.onRetry,
    );
  }
}
