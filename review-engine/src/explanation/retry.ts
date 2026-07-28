/**
 * Retry with exponential backoff and jitter.
 *
 * Jitter is not decoration: a game review fires ~40 explanation requests at
 * once, so a fixed backoff would make every one of them retry in lockstep and
 * re-create the burst that caused the rate limit. Randomising spreads them out.
 *
 * Only errors that declare themselves retryable are retried — see {@link ./errors}.
 */

import { GeminiError } from './errors';

export interface RetryConfig {
  /** Total attempts including the first. */
  readonly attempts: number;
  /** Delay before the first retry, in ms. Doubles each time. */
  readonly baseDelayMs: number;
  /** Upper bound on any single delay. */
  readonly maxDelayMs: number;
  /** Random fraction (0–1) added to each delay to de-synchronise callers. */
  readonly jitter: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  attempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 8000,
  jitter: 0.3,
};

/** Injected so tests do not actually sleep. */
export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `task`, retrying transient failures.
 *
 * @param onRetry Observability hook — lets the host log or count retries
 *                without this module importing a logger.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
  sleep: Sleeper = realSleep,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof GeminiError ? error.retryable : false;
      if (!retryable || attempt === config.attempts) break;

      const exponential = config.baseDelayMs * 2 ** (attempt - 1);
      const capped = Math.min(exponential, config.maxDelayMs);
      const delay = Math.round(capped * (1 + Math.random() * config.jitter));
      onRetry?.(attempt, delay, error);
      await sleep(delay);
    }
  }
  throw lastError;
}
