/**
 * Forced — there was nothing else to play.
 *
 * Outranks every quality verdict: a player cannot be credited or blamed for a
 * move they had no choice about.
 */

import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';

export class ForcedRule extends BaseRule {
  readonly id = 'forced';
  protected readonly rank = 90;

  applies(ctx: ClassificationContext): boolean {
    return ctx.onlyMove;
  }

  classify(ctx: ClassificationContext): RuleVerdict {
    return {
      classification: 'Forced',
      confidence: 1,
      reasons: ['This was the only legal move.'],
      metadata: { legalMoveCount: ctx.analysis.legalMoves.length },
    };
  }
}
