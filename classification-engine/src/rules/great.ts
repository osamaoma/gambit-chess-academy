/**
 * Great — the one move that held the position together.
 *
 * Needs MultiPV to know how far the best move beat the alternatives. Without
 * it the rule DECLINES rather than guessing, which is what keeps the label
 * meaningful.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';
import { clamp01 } from '../types';

export class GreatRule extends BaseRule {
  readonly id = 'great';
  protected readonly rank = 70;

  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    const c = config.great;
    return ctx.analysis.depth >= c.minDepth
      && ctx.playedBest
      && ctx.gapToSecondBest != null
      && ctx.gapToSecondBest >= c.minGapToSecondBest
      && ctx.winPctDrop <= c.maxWinPctLoss;
  }

  classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict {
    const gap = ctx.gapToSecondBest ?? 0;
    const margin = clamp01(gap / (config.great.minGapToSecondBest * 2));
    return {
      classification: 'Great',
      confidence: clamp01(0.75 + 0.25 * margin),
      reasons: ['This was clearly the strongest move — the alternatives were much weaker.'],
      metadata: { gapToSecondBest: gap },
    };
  }
}
