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

/**
 * Classifications on which a detector may praise good positional play.
 *
 * Includes the "unremarkable but fine" grades (`excellent`, `book`, `forced`):
 * a review should still say what a book move ACHIEVES — "puts a pawn in the
 * centre" is useful whether or not the move is theory — instead of falling
 * silent on the opening, which is where most players need the explanation most.
 */
export const PRAISE_CLASSES: ReadonlySet<MoveClassification> = new Set([
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced',
]);

/** Classifications on which a detector may flag a positional flaw. */
export const CRITIQUE_CLASSES: ReadonlySet<MoveClassification> = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

/** The full list a positional detector registers for (praise + critique). */
export const POSITIONAL_CLASSES: readonly MoveClassification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced',
  'inaccuracy', 'mistake', 'miss', 'blunder',
];

export function isPraiseClass(c: MoveClassification): boolean {
  return PRAISE_CLASSES.has(c);
}

export function isCritiqueClass(c: MoveClassification): boolean {
  return CRITIQUE_CLASSES.has(c);
}
