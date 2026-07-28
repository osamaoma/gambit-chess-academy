/**
 * Best — the engine's first choice, with nothing rarer to say about it.
 *
 * Sits below Brilliant, Great and Miss: those are also usually the best move,
 * and each says more.
 */

import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';

export class BestRule extends BaseRule {
  readonly id = 'best';
  protected readonly rank = 50;

  applies(ctx: ClassificationContext): boolean {
    return ctx.playedBest;
  }

  classify(ctx: ClassificationContext): RuleVerdict {
    return {
      classification: 'Best',
      confidence: 0.95,
      reasons: ['This was the strongest move in the position.'],
      metadata: { winPctDrop: ctx.winPctDrop },
    };
  }
}
