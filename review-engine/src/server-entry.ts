/**
 * Server-side entry point.
 *
 * Bundled to CommonJS and committed as `server-lib/gemini-explain.cjs` so
 * `server.js` can require it without a TypeScript build step on the host. That
 * keeps the prompt wording and the output rules in ONE place — the package —
 * instead of being retyped into the Express route and drifting from it.
 */

export {
  buildSystemInstruction,
  buildUserPromptFromFacts,
  DEFAULT_PROMPT_CONFIG,
  type PromptFacts,
} from './explanation/prompt-builder';

export { parseExplanation, DEFAULT_PARSER_CONFIG } from './explanation/response-parser';
export { GeminiError } from './explanation/errors';
