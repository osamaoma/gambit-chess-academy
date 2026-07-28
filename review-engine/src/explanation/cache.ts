/**
 * Caching for generated explanations.
 *
 * Two reasons this matters more than usual here:
 *  - a user re-opening the same game would otherwise pay for the same ~40
 *    generations again;
 *  - stepping back and forth through a review re-requests the same move
 *    constantly, and a cache turns that into an instant response.
 *
 * The key is a hash of the STRUCTURED ANALYSIS, never the prose: identical
 * chess facts should reuse the same explanation, and any change in the facts
 * must produce a fresh one.
 */

/** Minimal store contract so a host can swap in Redis or localStorage. */
export interface ExplanationCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  readonly size: number;
}

/**
 * In-memory LRU. Bounded because a long session would otherwise grow without
 * limit; least-recently-used is the right eviction order for review browsing,
 * where users revisit recent moves.
 */
export class LruCache<T> implements ExplanationCache<T> {
  private readonly store = new Map<string, T>();

  constructor(private readonly maxEntries = 500) {}

  get(key: string): T | undefined {
    if (!this.store.has(key)) return undefined;
    // Re-insert to mark as most recently used.
    const value = this.store.get(key) as T;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Stable, order-independent hash of an arbitrary structure.
 *
 * Object key order must not change the key, or two identical analyses would
 * miss the cache purely because of property ordering. FNV-1a is used rather
 * than a crypto hash: this is a cache key, not a security boundary, and it has
 * to run in the browser without extra dependencies.
 */
export function hashKey(value: unknown): string {
  const json = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + '-' + json.length.toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
