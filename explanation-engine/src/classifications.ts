/**
 * Shared classification groupings used by the positional detectors.
 *
 * The strategic detectors (piece activity, pawn structure, centre control,
 * endgame) all follow the same rule: PRAISE a strong idea only when the
 * classifier already liked the move, and CRITICISE a positional flaw only when
 * the classifier already disliked it — so a detector never contradicts the
 * engine's verdict. These two sets are that convention, defined once.
 */

import { MoveClassification } from './types';

/** Classifications on which a detector may praise good positional play. */
export const PRAISE_CLASSES: ReadonlySet<MoveClassification> = new Set(['great', 'best', 'good']);

/** Classifications on which a detector may flag a positional flaw. */
export const CRITIQUE_CLASSES: ReadonlySet<MoveClassification> = new Set(['inaccuracy', 'mistake']);

export function isPraiseClass(c: MoveClassification): boolean {
  return PRAISE_CLASSES.has(c);
}

export function isCritiqueClass(c: MoveClassification): boolean {
  return CRITIQUE_CLASSES.has(c);
}
