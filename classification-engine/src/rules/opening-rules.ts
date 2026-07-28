/**
 * Rules that answer "was there anything to judge here at all?".
 *
 * Both run before any quality assessment, because grading a move the player
 * had no choice about — or one straight out of theory — teaches nothing and
 * actively misleads. A forced recapture is not "Excellent"; it is forced.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { ClassificationRule, RuleVerdict } from '../rule';

/** Theory: the move is still in the opening book. */
export class BookRule implements ClassificationRule {
  readonly id = 'book';
  readonly priority = 100;

  evaluate(ctx: ClassificationContext): RuleVerdict | null {
    const opening = ctx.analysis.opening;
    if (!opening?.isBook) return null;
    return {
      classification: 'Book',
      confidence: 1,
      reasons: [
        opening.name
          ? `Still in opening theory (${opening.name}).`
          : 'Still in opening theory.',
      ],
      metadata: { openingName: opening.name ?? null, eco: opening.eco ?? null },
    };
  }
}

/**
 * There was nothing else to play.
 *
 * Ranked below Book only because a book move is the more informative label
 * when both apply; a single legal move is otherwise the strongest possible
 * statement about a position, so it outranks every quality verdict.
 */
export class ForcedRule implements ClassificationRule {
  readonly id = 'forced';
  readonly priority = 90;

  evaluate(ctx: ClassificationContext): RuleVerdict | null {
    if (!ctx.onlyMove) return null;
    return {
      classification: 'Forced',
      confidence: 1,
      reasons: ['This was the only legal move.'],
      metadata: { legalMoveCount: ctx.analysis.legalMoves.length },
    };
  }
}
