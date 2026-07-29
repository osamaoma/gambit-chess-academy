/**
 * Shared base for the routine verdicts (Excellent … Blunder).
 *
 * They differ only in which slice of severity they own and what they say about
 * it, so the measuring lives here once. Each band is still its own rule class,
 * registered and tested independently — this base removes duplication, not
 * separation.
 *
 * A move is measured on three signals (win% lost, centipawns lost, evaluation
 * swing), each scaled for the game phase, and the combining policy decides what
 * to do when they disagree. Nothing here is a literal: every number comes from
 * {@link ClassifierConfig}.
 */

import { BandThresholds, ClassifierConfig, thresholdsFor } from '../config';
import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';
import { Classification, clamp01 } from '../types';

/** The bands, worst last. Blunder has no ceiling, which makes the set total. */
export const BAND_ORDER = ['Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'] as const;
export type BandName = (typeof BAND_ORDER)[number];

/** The three measurements a band is judged on. */
export type Signal = 'winPctDrop' | 'centipawnLoss' | 'evalSwing';
const SIGNALS: readonly Signal[] = ['winPctDrop', 'centipawnLoss', 'evalSwing'];

/** Ceilings for the four bounded bands, already scaled for the phase. */
function ceilings(ctx: ClassificationContext, config: ClassifierConfig): BandThresholds[] {
  const q = config.quality;
  const phase = ctx.analysis.phase;
  return [q.excellent, q.good, q.inaccuracy, q.mistake].map((b) => thresholdsFor(b, phase, q));
}

/** Which band one signal alone puts this move in. */
function bandIndexForSignal(value: number, signal: Signal, scaled: readonly BandThresholds[]): number {
  for (let i = 0; i < scaled.length; i++) {
    if (value <= scaled[i]![signal]) return i;
  }
  return scaled.length;            // past every ceiling → Blunder
}

export interface BandVerdictDetail {
  readonly index: number;
  readonly band: BandName;
  /** The signal that decided it, for metadata and confidence. */
  readonly decidedBy: Signal;
  readonly measured: Readonly<Record<Signal, number>>;
  readonly perSignal: Readonly<Record<Signal, BandName>>;
}

/**
 * Measure a move and decide which band owns it.
 *
 * Exported because it is useful on its own — it explains WHY a move landed
 * where it did, which is otherwise guesswork when three signals disagree.
 */
export function qualityBandOf(ctx: ClassificationContext, config: ClassifierConfig): BandVerdictDetail {
  const scaled = ceilings(ctx, config);
  const measured: Record<Signal, number> = {
    winPctDrop: ctx.winPctDrop,
    centipawnLoss: ctx.centipawnLoss,
    evalSwing: ctx.evalSwing,
  };

  const perIndex: Record<Signal, number> = {
    winPctDrop: bandIndexForSignal(measured.winPctDrop, 'winPctDrop', scaled),
    centipawnLoss: bandIndexForSignal(measured.centipawnLoss, 'centipawnLoss', scaled),
    evalSwing: bandIndexForSignal(measured.evalSwing, 'evalSwing', scaled),
  };

  const policy = config.quality.combine;
  let decidedBy: Signal;
  if (policy === 'worst') {
    // If ANY signal says the move was bad, report it as bad. Being wrong in the
    // generous direction hides real errors from a learner; the reverse merely
    // over-warns, which is the safer failure.
    decidedBy = SIGNALS.reduce((a, b) => (perIndex[b] > perIndex[a] ? b : a));
  } else {
    decidedBy = policy;
  }

  const index = perIndex[decidedBy];
  return {
    index,
    band: BAND_ORDER[index] as BandName,
    decidedBy,
    measured,
    perSignal: {
      winPctDrop: BAND_ORDER[perIndex.winPctDrop] as BandName,
      centipawnLoss: BAND_ORDER[perIndex.centipawnLoss] as BandName,
      evalSwing: BAND_ORDER[perIndex.evalSwing] as BandName,
    },
  };
}

export abstract class QualityBandRule extends BaseRule {
  abstract readonly classification: Classification;
  /** Position in {@link BAND_ORDER}. */
  protected abstract readonly index: number;
  /** The sentence shown when this band wins. */
  protected abstract readonly reason: string;

  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    return qualityBandOf(ctx, config).index === this.index;
  }

  classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict {
    const detail = qualityBandOf(ctx, config);
    return {
      classification: this.classification,
      confidence: bandConfidence(detail, ctx, config),
      reasons: [this.reason],
      metadata: {
        decidedBy: detail.decidedBy,
        winPctDrop: round(detail.measured.winPctDrop),
        centipawnLoss: round(detail.measured.centipawnLoss),
        evalSwing: round(detail.measured.evalSwing),
        perSignalBands: detail.perSignal,
        phase: ctx.analysis.phase,
        phaseMultiplier: config.quality.phaseMultipliers[ctx.analysis.phase] ?? 1,
      },
    };
  }
}

/**
 * Confidence falls off near a band edge.
 *
 * A move sitting just inside a boundary would have been labelled differently by
 * a slightly deeper search, and the verdict should admit that. Measured on the
 * signal that actually decided the band — the others are irrelevant to how
 * close this call was.
 */
export function bandConfidence(
  detail: BandVerdictDetail,
  ctx: ClassificationContext,
  config: ClassifierConfig,
): number {
  const signal = detail.decidedBy;
  const scaled = ceilings(ctx, config);
  const value = detail.measured[signal];

  const edges = [0, ...scaled.map((b) => b[signal])];
  let nearest = Infinity;
  for (const edge of edges) nearest = Math.min(nearest, Math.abs(value - edge));

  // Normalise against the width of the band we landed in, so a 5cp margin is
  // "close" in a narrow band and comfortable in a wide one.
  const lower = detail.index === 0 ? 0 : scaled[detail.index - 1]![signal];
  const upper = detail.index < scaled.length ? scaled[detail.index]![signal] : lower * 2 || 1;
  const width = Math.max(1, upper - lower);

  return clamp01(0.6 + 0.35 * Math.min(1, nearest / (width / 2)));
}

const round = (n: number): number => Math.round(n * 10) / 10;
