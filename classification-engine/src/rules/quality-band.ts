/**
 * Shared base for the five routine verdicts (Excellent … Blunder).
 *
 * They differ only in which slice of "win probability lost" they own and what
 * they say about it, so the banding arithmetic and the edge-aware confidence
 * live here once. Each band is still its own rule class, registered and tested
 * independently — this base removes duplication, not separation.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';
import { Classification, clamp01 } from '../types';

export abstract class QualityBandRule extends BaseRule {
  abstract readonly classification: Classification;
  /** The sentence shown when this band wins. */
  protected abstract readonly reason: string;

  /** Inclusive upper bound of this band, in win% lost. Infinity = the last band. */
  protected abstract upperBound(config: ClassifierConfig): number;
  /** Exclusive lower bound — the previous band's ceiling. */
  protected abstract lowerBound(config: ClassifierConfig): number;

  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    const drop = ctx.winPctDrop;
    return drop > this.lowerBound(config) && drop <= this.upperBound(config);
  }

  classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict {
    return {
      classification: this.classification,
      confidence: bandConfidence(ctx.winPctDrop, config),
      reasons: [this.reason],
      metadata: { winPctDrop: ctx.winPctDrop, centipawnLoss: ctx.analysis.centipawnLoss },
    };
  }
}

/**
 * Confidence falls off near a band edge.
 *
 * A move sitting one win% from a boundary would have been labelled differently
 * by a slightly deeper search, and the verdict should admit that. Well inside a
 * band, confidence approaches 0.95.
 */
export function bandConfidence(drop: number, config: ClassifierConfig): number {
  const b = config.quality;
  const edges = [0, b.excellent, b.good, b.inaccuracy, b.mistake];
  let nearest = Infinity;
  for (const edge of edges) nearest = Math.min(nearest, Math.abs(drop - edge));
  return clamp01(0.6 + 0.35 * Math.min(1, nearest / 5));
}
