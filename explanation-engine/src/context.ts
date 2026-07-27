/**
 * Per-move parse cache.
 *
 * A single move is examined by every registered detector, and each one used to
 * re-parse the same two FEN strings — up to `2 × detectorCount` `parseFen`
 * calls per move. Since a {@link MoveContext} is immutable, its boards can be
 * parsed once and shared: `boardsOf` memoises them on the context object
 * (via a `WeakMap`, so they're collected with the context and never leak).
 *
 * Malformed FENs resolve to `null` once and stay cached, so a bad context is
 * cheap on every subsequent detector too.
 */

import { Board, parseFen } from './board';
import { MoveContext } from './types';

export interface MoveBoards {
  /** The position the move was played from. */
  readonly before: Board;
  /** The position the move produced. */
  readonly after: Board;
}

const cache = new WeakMap<MoveContext, MoveBoards | null>();

/** Parse (once) and return the before/after boards for a move, or null if a FEN is malformed. */
export function boardsOf(ctx: MoveContext): MoveBoards | null {
  if (cache.has(ctx)) return cache.get(ctx) as MoveBoards | null;
  let boards: MoveBoards | null;
  try {
    boards = { before: parseFen(ctx.fenBefore), after: parseFen(ctx.fenAfter) };
  } catch {
    boards = null;
  }
  cache.set(ctx, boards);
  return boards;
}
