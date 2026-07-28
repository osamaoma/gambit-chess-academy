/**
 * Rules that grade what went wrong.
 *
 * {@link MissRule} runs before the quality bands because a thrown-away win is a
 * different lesson from a merely bad move: the player was winning and stopped
 * winning, which is worth naming even when the centipawn cost is unremarkable.
 *
 * {@link QualityBandRule} is the catch-all and must always return a verdict —
 * it is the reason every move gets a label.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { ClassificationRule, RuleVerdict } from '../rule';
import { Classification, clamp01 } from '../types';

/** A winning chance — or an outright forced mate — let slip. */
export class MissRule implements ClassificationRule {
  readonly id = 'miss';
  readonly priority = 60;

  evaluate(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict | null {
    const c = config.miss;
    if (ctx.playedBest) return null;

    // Letting a forced mate go is the clearest miss there is.
    if (c.missedMateIsMiss && ctx.hadForcedMate && !ctx.deliversMate) {
      return {
        classification: 'Miss',
        confidence: 0.95,
        reasons: ['There was a forced checkmate available here.'],
        metadata: { mateBefore: ctx.analysis.mateBefore, missedMate: true },
      };
    }

    if (ctx.winPctBefore < c.minWinPctBefore) return null;
    if (ctx.winPctDrop < c.minWinPctDrop) return null;

    const severity = clamp01(ctx.winPctDrop / Math.max(1, 100 - c.minWinPctBefore));
    return {
      classification: 'Miss',
      confidence: clamp01(0.7 + 0.25 * severity),
      reasons: ['A winning opportunity slipped away here.'],
      metadata: { winPctBefore: ctx.winPctBefore, winPctDrop: ctx.winPctDrop, missedMate: false },
    };
  }
}

/**
 * The routine verdict, from Excellent down to Blunder.
 *
 * Lowest priority and never returns null: whatever the position, the engine
 * always produces a classification, so callers never handle an "unknown" case.
 */
export class QualityBandRule implements ClassificationRule {
  readonly id = 'quality-band';
  readonly priority = 0;

  evaluate(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict {
    const bands = config.quality;
    const drop = ctx.winPctDrop;

    let classification: Classification;
    let reason: string;
    if (drop <= bands.excellent) {
      classification = 'Excellent';
      reason = 'Almost as good as the top choice.';
    } else if (drop <= bands.good) {
      classification = 'Good';
      reason = 'A reasonable move that keeps the position healthy.';
    } else if (drop <= bands.inaccuracy) {
      classification = 'Inaccuracy';
      reason = 'This lets some of the advantage slip.';
    } else if (drop <= bands.mistake) {
      classification = 'Mistake';
      reason = 'This gives up a serious part of the position.';
    } else {
      classification = 'Blunder';
      reason = 'This changes the outcome of the game.';
    }

    // Confidence is highest in the middle of a band and lowest at its edges,
    // where a slightly different search would have produced a different label.
    return {
      classification,
      confidence: bandConfidence(drop, bands),
      reasons: [reason],
      metadata: { winPctDrop: drop, centipawnLoss: ctx.analysis.centipawnLoss },
    };
  }
}

/** How far the measurement sits from the nearest band edge, normalised to 0–1. */
function bandConfidence(drop: number, bands: ClassifierConfig['quality']): number {
  const edges = [0, bands.excellent, bands.good, bands.inaccuracy, bands.mistake];
  let nearest = Infinity;
  for (const edge of edges) nearest = Math.min(nearest, Math.abs(drop - edge));
  // Within 1 win% of an edge → 0.6; a comfortable 5 points away → ~0.95.
  return clamp01(0.6 + 0.35 * Math.min(1, nearest / 5));
}
