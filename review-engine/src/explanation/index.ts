/**
 * Gemini-backed explanation subsystem.
 *
 * Wiring (server side — the key must never reach a browser bundle):
 *
 * ```ts
 * const service = new GeminiService({ apiKey: process.env.GEMINI_API_KEY! });
 * const generator = new GeminiExplanationGenerator(service, {
 *   onError: (e) => logger.warn({ e }, 'explanation failed'),
 * });
 * const note = await generator.generate(explanationInput);
 * ```
 *
 * In the browser, point a {@link Transport} at your own proxy endpoint instead
 * of at Google, so the key stays on your server.
 */

export { GeminiService, DEFAULT_GEMINI_CONFIG, type GeminiConfig, type GenerateRequest, type Transport } from './gemini-service';
export { GeminiExplanationGenerator, type GeminiGeneratorOptions } from './gemini-explanation-generator';
export {
  buildSystemInstruction,
  buildUserPrompt,
  buildUserPromptFromFacts,
  type PromptFacts,
  promptCacheKeyInput,
  DEFAULT_PROMPT_CONFIG,
  type PromptConfig,
} from './prompt-builder';
export {
  extractText,
  parseExplanation,
  DEFAULT_PARSER_CONFIG,
  type GeminiResponseBody,
  type ParsedExplanation,
  type ParserConfig,
} from './response-parser';
export { GeminiError, errorFromStatus, type GeminiErrorKind } from './errors';
export { withRetry, DEFAULT_RETRY, type RetryConfig, type Sleeper } from './retry';
export { LruCache, hashKey, type ExplanationCache } from './cache';
