/**
 * Typed errors for the explanation service.
 *
 * The distinction that matters operationally is RETRYABLE vs not. Retrying a
 * rejected API key just burns quota and delays the user; retrying a 503 is
 * exactly the right move. Encoding that on the error means the retry policy
 * needs no knowledge of HTTP.
 */

export type GeminiErrorKind =
  | 'config'        // no API key, bad model name — will never succeed
  | 'auth'          // 401/403 — key rejected
  | 'rate-limit'    // 429 — back off and try again
  | 'server'        // 5xx — transient
  | 'network'       // fetch threw / timed out
  | 'blocked'       // safety filters or empty candidate list
  | 'validation'    // well-formed, but broke a writing rule — resampling may fix it
  | 'malformed';    // 200 but the body was not what we expect

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  readonly status?: number | undefined;
  /** Should a retry be attempted at all? */
  readonly retryable: boolean;

  constructor(kind: GeminiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
    // 'validation' is retryable because the model is sampled: a second draft
    // routinely obeys a rule the first one broke.
    this.retryable =
      kind === 'rate-limit' || kind === 'server' || kind === 'network' || kind === 'validation';
  }
}

/** Map an HTTP status onto the right error kind. */
export function errorFromStatus(status: number, body: string): GeminiError {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) return new GeminiError('auth', `API key rejected (${status}). ${detail}`, status);
  if (status === 429) return new GeminiError('rate-limit', `Rate limited (429). ${detail}`, status);
  if (status >= 500) return new GeminiError('server', `Upstream error (${status}). ${detail}`, status);
  return new GeminiError('malformed', `Unexpected response (${status}). ${detail}`, status);
}
