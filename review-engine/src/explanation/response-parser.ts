/**
 * Turns a raw Gemini response into a validated coaching note.
 *
 * A prompt is a request, not a guarantee. The model will occasionally wrap the
 * note in quotes, add "Here's a note for your student:", drift over the word
 * limit, or slip in the word "engine". Everything the prompt asks for is
 * therefore ALSO enforced here, because the prompt is the polite version and
 * this is the one that actually holds.
 */

import { GeminiError } from './errors';

/** Shape of the bit of the Gemini payload we depend on. */
export interface GeminiResponseBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export interface ParserConfig {
  readonly maxWords: number;
  /**
   * Words that must never reach the user. The model is told to avoid them;
   * this is the enforcement.
   */
  readonly bannedTerms: readonly string[];
}

export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  maxWords: 80,
  bannedTerms: ['stockfish', 'centipawn', 'centipawns', 'engine', 'eval', 'evaluation', 'cp loss'],
};

export interface ParsedExplanation {
  readonly summary: string;
  /** True when the text had to be shortened to meet the word limit. */
  readonly truncated: boolean;
}

/** Pull the text out of the payload, or throw a typed error explaining why not. */
export function extractText(body: GeminiResponseBody): string {
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) throw new GeminiError('blocked', `Request blocked by safety filters: ${blocked}`);

  const candidate = body.candidates?.[0];
  if (!candidate) throw new GeminiError('blocked', 'Model returned no candidates.');

  const text = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) throw new GeminiError('malformed', 'Model returned an empty note.');
  return text;
}

/**
 * Clean and validate the note.
 *
 * @throws GeminiError when the text breaks a rule that cannot be repaired by
 *         editing — the caller then retries or falls back, which is far better
 *         than showing a student a note that mentions centipawns.
 */
export function parseExplanation(raw: string, config: ParserConfig = DEFAULT_PARSER_CONFIG): ParsedExplanation {
  let text = raw.trim();

  // Strip markdown decoration and common conversational preambles.
  text = text.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  text = text.replace(/^(here'?s?|sure|certainly)[^:]{0,40}:\s*/i, '').trim();
  text = text.replace(/^[*_>#\s-]+/, '').replace(/[*_`]/g, '').trim();
  // Unwrap a fully quoted note, but leave internal quotation marks alone.
  if (/^["'"].*["'"]$/s.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/\s+/g, ' ');

  if (!text) throw new GeminiError('validation', 'Note was empty after cleaning.');

  const lower = text.toLowerCase();
  for (const term of config.bannedTerms) {
    // Word-boundary match so "evaluation" is caught but "eventually" is not.
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      throw new GeminiError('validation', `Note mentioned a forbidden term: "${term}".`);
    }
  }

  const words = text.split(/\s+/);
  if (words.length <= config.maxWords) return { summary: text, truncated: false };

  // Over the limit: cut at the last sentence that fits, rather than mid-phrase.
  const clipped = words.slice(0, config.maxWords).join(' ');
  const lastStop = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('!'), clipped.lastIndexOf('?'));
  const summary = lastStop > 40 ? clipped.slice(0, lastStop + 1) : `${clipped.replace(/[,;:]$/, '')}…`;
  return { summary, truncated: true };
}
