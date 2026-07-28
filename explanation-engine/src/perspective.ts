/**
 * Whose move is this, from the reader's point of view?
 *
 * A review is read by ONE person, so an explanation should address them
 * directly — "Your knight comes into play" when they made the move, "Their
 * knight…" when the opponent did. That requires knowing which side the reader
 * played ({@link MoveMeta.viewerColor}); when the host doesn't supply it we
 * fall back to naming the colour, which is always correct if less personal.
 *
 * Centralising the wording here keeps the pronoun rule out of every detector
 * (one place to change the voice of the whole product).
 */

import { MoveContext } from './types';

/** Did the reader of the review play this move? Unknown → false. */
export function isViewerMove(ctx: MoveContext): boolean {
  const viewer = ctx.meta?.viewerColor;
  return viewer != null && viewer === ctx.mover;
}

/** Possessive for the mover: "Your" / "Their" (or "White's" / "Black's"). */
export function movers(ctx: MoveContext): string {
  const viewer = ctx.meta?.viewerColor;
  if (viewer == null) return ctx.mover === 'white' ? "White's" : "Black's";
  return viewer === ctx.mover ? 'Your' : 'Their';
}

/** Lower-case possessive for mid-sentence use: "your" / "their". */
export function moversLower(ctx: MoveContext): string {
  return lower(movers(ctx));
}

/** Possessive for the side NOT moving: "Your" / "Their" (or "White's"/"Black's"). */
export function opponents(ctx: MoveContext): string {
  const viewer = ctx.meta?.viewerColor;
  if (viewer == null) return ctx.mover === 'white' ? "Black's" : "White's";
  return viewer === ctx.mover ? 'Their' : 'Your';
}

/** Lower-case form of {@link opponents}. */
export function opponentsLower(ctx: MoveContext): string {
  return lower(opponents(ctx));
}

/** Subject pronoun for the mover: "You" / "They" (or "White" / "Black"). */
export function moverSubject(ctx: MoveContext): string {
  const viewer = ctx.meta?.viewerColor;
  if (viewer == null) return ctx.mover === 'white' ? 'White' : 'Black';
  return viewer === ctx.mover ? 'You' : 'They';
}

/** "White's" → "white's"; leaves already-lower words alone. */
function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
