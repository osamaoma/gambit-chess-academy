/**
 * Brilliant — a sound sacrifice that is hard to find.
 *
 * The guards are all necessary and each rules out a specific false positive:
 *  - material must be ON OFFER (see `offeredCp`) — a sacrifice costs nothing
 *    until it is accepted, so diffing material across the move detects nothing;
 *  - the move must still be (near-)best, or a losing sacrifice looks brilliant;
 *  - the position must stay good, or it is a blunder with style;
 *  - it must be past the opening, where sacrifices are memorised theory;
 *  - the search must be deep enough to tell the two apart at all.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';
import { clamp01 } from '../types';

export class BrilliantRule extends BaseRule {
  readonly id = 'brilliant';
  protected readonly rank = 80;

  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    const c = config.brilliant;
    return ctx.analysis.depth >= c.minDepth
      && ctx.ply >= c.minPly
      && ctx.offeredCp >= c.minSacrificeCp
      && ctx.winPctDrop <= c.maxWinPctLoss
      && ctx.winPctAfter >= c.minWinPctAfter;
  }

  classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict {
    const c = config.brilliant;
    const investment = clamp01(ctx.offeredCp / (c.minSacrificeCp * 3));
    const cleanliness = clamp01(1 - ctx.winPctDrop / Math.max(1, c.maxWinPctLoss));
    return {
      classification: 'Brilliant',
      confidence: clamp01(0.7 + 0.15 * investment + 0.15 * cleanliness),
      reasons: [
        `Offers ${Math.round(ctx.offeredCp / 100)} points of material and stays winning.`,
        'The compensation is real, which is what separates a sacrifice from a blunder.',
      ],
      metadata: { offeredCp: ctx.offeredCp, sacrificedCp: ctx.sacrificedCp, winPctAfter: ctx.winPctAfter },
    };
  }
}
