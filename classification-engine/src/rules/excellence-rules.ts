/**
 * Rules that reward the player.
 *
 * Precedence among them is deliberate: Brilliant > Great > Best. A brilliant
 * move is also the best move, and a great move usually is too, so the rarest
 * and most informative label has to be asked first.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { ClassificationRule, RuleVerdict } from '../rule';
import { clamp01 } from '../types';

/**
 * A sound sacrifice that a human would struggle to find.
 *
 * The four conditions are all necessary, and each rules out a specific false
 * positive:
 *  - material must actually be GIVEN UP (otherwise every good capture qualifies);
 *  - the move must still be (near-)best, judged by the engine (otherwise a
 *    losing sacrifice looks brilliant);
 *  - the position must stay good for the mover (a "brilliant" move that leaves
 *    you lost is just a blunder with style);
 *  - it must be past the opening, where sacrifices are memorised theory.
 *
 * Shallow searches cannot be trusted to tell a sacrifice from a blunder, so a
 * minimum depth is required rather than merely lowering confidence.
 */
export class BrilliantRule implements ClassificationRule {
  readonly id = 'brilliant';
  readonly priority = 80;

  evaluate(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict | null {
    const c = config.brilliant;
    if (ctx.analysis.depth < c.minDepth) return null;
    if (ctx.ply < c.minPly) return null;
    if (ctx.sacrificedCp < c.minSacrificeCp) return null;
    if (ctx.winPctDrop > c.maxWinPctLoss) return null;
    if (ctx.winPctAfter < c.minWinPctAfter) return null;

    // The bigger the investment and the smaller the cost, the surer we are.
    const investment = clamp01(ctx.sacrificedCp / (c.minSacrificeCp * 3));
    const cleanliness = clamp01(1 - ctx.winPctDrop / Math.max(1, c.maxWinPctLoss));
    return {
      classification: 'Brilliant',
      confidence: clamp01(0.7 + 0.15 * investment + 0.15 * cleanliness),
      reasons: [
        `Gives up ${Math.round(ctx.sacrificedCp / 100)} points of material and stays winning.`,
        'The compensation is real, which is what separates a sacrifice from a blunder.',
      ],
      metadata: { sacrificedCp: ctx.sacrificedCp, winPctAfter: ctx.winPctAfter },
    };
  }
}

/**
 * The one move that holds the position together.
 *
 * "Great" means the alternatives were materially worse — so it needs MultiPV.
 * Without alternatives the gap is unknown and the rule declines rather than
 * guessing, which keeps the label meaningful.
 */
export class GreatRule implements ClassificationRule {
  readonly id = 'great';
  readonly priority = 70;

  evaluate(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict | null {
    const c = config.great;
    if (ctx.analysis.depth < c.minDepth) return null;
    if (ctx.gapToSecondBest == null) return null;
    if (ctx.gapToSecondBest < c.minGapToSecondBest) return null;
    if (ctx.winPctDrop > c.maxWinPctLoss) return null;
    if (!ctx.playedBest) return null;

    const margin = clamp01(ctx.gapToSecondBest / (c.minGapToSecondBest * 2));
    return {
      classification: 'Great',
      confidence: clamp01(0.75 + 0.25 * margin),
      reasons: [
        'This was clearly the strongest move — the alternatives were much weaker.',
      ],
      metadata: { gapToSecondBest: ctx.gapToSecondBest },
    };
  }
}

/** The engine's first choice, with nothing rarer to say about it. */
export class BestRule implements ClassificationRule {
  readonly id = 'best';
  readonly priority = 50;

  evaluate(ctx: ClassificationContext): RuleVerdict | null {
    if (!ctx.playedBest) return null;
    return {
      classification: 'Best',
      confidence: 0.95,
      reasons: ['This was the strongest move in the position.'],
      metadata: { winPctDrop: ctx.winPctDrop },
    };
  }
}
