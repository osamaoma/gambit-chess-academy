/**
 * Every tunable number in the engine.
 *
 * This file is the ONLY place a threshold may live. Rules read values from the
 * config they are handed and never inline a constant, so a product decision
 * ("blunders should start later for beginners") is a config change, not a code
 * change — and per-rating-band tuning or an A/B test needs no new code.
 */

import { GamePhase } from './types';

/* ────────────────────────────── quality bands ──────────────────────────────── */

/**
 * The ceiling of one band, measured on three independent signals.
 *
 * Three rather than one because each catches something the others miss:
 *
 *  - `winPctDrop` — practical damage. The only signal that knows +900 → +800
 *    is nothing while +100 → 0 is a catastrophe.
 *  - `centipawnLoss` — raw cost against best play. Still meaningful where win%
 *    saturates: at ±95% win probability almost any move scores "no damage",
 *    but giving away a rook is worth naming.
 *  - `evalSwing` — how far the position itself moved. Differs from centipawn
 *    loss whenever the best move was ALSO a concession (zugzwang, forced
 *    recaptures): loss can be ~0 while the position collapses, and a review
 *    that stays silent there is unhelpful.
 *
 * All three are compared, and the combining policy decides what to do with
 * disagreement — see {@link QualityBandConfig.combine}.
 */
export interface BandThresholds {
  /** Max win probability lost (0–100) still inside this band. */
  readonly winPctDrop: number;
  /** Max centipawns given up against best play. */
  readonly centipawnLoss: number;
  /** Max centipawns the position itself deteriorated. */
  readonly evalSwing: number;
}

/**
 * How to resolve signals that disagree.
 *
 * 'worst' is the default and the safe one: if any signal says the move was bad,
 * it is reported as bad. Choosing a single signal is offered because a product
 * may deliberately want, say, pure win%-based grading to match another site.
 */
export type CombinePolicy = 'worst' | 'winPctDrop' | 'centipawnLoss' | 'evalSwing';

export interface QualityBandConfig {
  /**
   * Tolerance for still calling a move "Best" when it was not literally the
   * engine's first choice. Defaults to zero on every signal, so by default only
   * the actual top move earns it — raise it to be more generous.
   */
  readonly best: BandThresholds;
  readonly excellent: BandThresholds;
  readonly good: BandThresholds;
  readonly inaccuracy: BandThresholds;
  readonly mistake: BandThresholds;
  /** No entry for Blunder: it is everything past Mistake, which is what makes
   *  the set exhaustive and guarantees every move gets a label. */

  /**
   * Per-phase scaling applied to every threshold above.
   *
   * The same centipawn loss does not mean the same thing throughout a game.
   * Openings are forgiving — many moves are playable and theory covers the
   * ground — while in an endgame a small slip is often the whole result. One
   * multiplier per phase expresses that without triplicating every number.
   */
  readonly phaseMultipliers: Readonly<Record<GamePhase, number>>;

  readonly combine: CombinePolicy;
}

/* ────────────────────────────── rare verdicts ──────────────────────────────── */

/** When a move may be called Brilliant. */
export interface BrilliantConfig {
  /** Minimum material (centipawns) the move must leave ON OFFER. */
  readonly minSacrificeCp: number;
  /** The move must cost at most this much win% versus best play. */
  readonly maxWinPctLoss: number;
  /** The mover must still be at least this good afterwards (win%). */
  readonly minWinPctAfter: number;
  /** Never award before this ply — opening gambits are theory, not brilliance. */
  readonly minPly: number;
  /** Require at least this search depth before trusting the verdict. */
  readonly minDepth: number;
}

/** When a move may be called Great. */
export interface GreatConfig {
  /** The best move must beat the second best by at least this much win%. */
  readonly minGapToSecondBest: number;
  /** The move must cost at most this much win% versus best play. */
  readonly maxWinPctLoss: number;
  readonly minDepth: number;
}

/** When a move counts as a Miss (a big chance thrown away). */
export interface MissConfig {
  /** The mover must have been at least this good beforehand (win%). */
  readonly minWinPctBefore: number;
  /** …and must have given up at least this much win%. */
  readonly minWinPctDrop: number;
  /** A missed forced mate is always a Miss, regardless of the numbers above. */
  readonly missedMateIsMiss: boolean;
}

/** Shape of the win-probability model. */
export interface WinProbabilityConfig {
  /** Logistic steepness per centipawn. Lichess-style default. */
  readonly k: number;
  /** Win% assigned to a forced mate (for the winning side). */
  readonly mateWinPct: number;
}

export interface ClassifierConfig {
  readonly quality: QualityBandConfig;
  readonly brilliant: BrilliantConfig;
  readonly great: GreatConfig;
  readonly miss: MissConfig;
  readonly winProbability: WinProbabilityConfig;
  /** Below this depth every verdict is reported with reduced confidence. */
  readonly lowDepthThreshold: number;
  /** Multiplier applied to confidence when the search was shallow. */
  readonly lowDepthConfidencePenalty: number;
}

/**
 * Defaults tuned to feel like a mainstream online review: most moves land on
 * Excellent/Good, and Blunder is reserved for genuinely game-changing errors.
 */
export const DEFAULT_CONFIG: ClassifierConfig = {
  quality: {
    best: { winPctDrop: 0, centipawnLoss: 0, evalSwing: 0 },
    excellent: { winPctDrop: 2, centipawnLoss: 25, evalSwing: 40 },
    good: { winPctDrop: 5, centipawnLoss: 70, evalSwing: 100 },
    inaccuracy: { winPctDrop: 10, centipawnLoss: 150, evalSwing: 200 },
    mistake: { winPctDrop: 20, centipawnLoss: 350, evalSwing: 450 },
    phaseMultipliers: {
      // Forgiving in the opening (many moves playable, theory covers it),
      // strict in the endgame (small slips decide the result).
      opening: 1.4,
      middlegame: 1,
      endgame: 0.75,
    },
    combine: 'worst',
  },
  brilliant: {
    minSacrificeCp: 150,
    maxWinPctLoss: 3,
    minWinPctAfter: 50,
    minPly: 8,
    minDepth: 14,
  },
  great: {
    minGapToSecondBest: 12,
    maxWinPctLoss: 2,
    minDepth: 12,
  },
  miss: {
    minWinPctBefore: 75,
    minWinPctDrop: 15,
    missedMateIsMiss: true,
  },
  winProbability: {
    k: 0.00368,
    mateWinPct: 100,
  },
  lowDepthThreshold: 10,
  lowDepthConfidencePenalty: 0.8,
};

/**
 * What a caller may override. Spelled out rather than derived by a clever
 * mapped type, because `phaseMultipliers` must be partial too — overriding one
 * phase should not force you to restate the other two.
 */
export interface ClassifierConfigOverrides {
  quality?: Partial<Omit<QualityBandConfig, 'phaseMultipliers'>> & {
    phaseMultipliers?: Partial<Record<GamePhase, number>>;
  };
  brilliant?: Partial<BrilliantConfig>;
  great?: Partial<GreatConfig>;
  miss?: Partial<MissConfig>;
  winProbability?: Partial<WinProbabilityConfig>;
  lowDepthThreshold?: number;
  lowDepthConfidencePenalty?: number;
}

/** Deep-merge a partial override onto the defaults. */
export function resolveConfig(overrides: ClassifierConfigOverrides = {}): ClassifierConfig {
  const q = overrides.quality ?? {};
  return {
    quality: {
      best: { ...DEFAULT_CONFIG.quality.best, ...q.best },
      excellent: { ...DEFAULT_CONFIG.quality.excellent, ...q.excellent },
      good: { ...DEFAULT_CONFIG.quality.good, ...q.good },
      inaccuracy: { ...DEFAULT_CONFIG.quality.inaccuracy, ...q.inaccuracy },
      mistake: { ...DEFAULT_CONFIG.quality.mistake, ...q.mistake },
      phaseMultipliers: { ...DEFAULT_CONFIG.quality.phaseMultipliers, ...q.phaseMultipliers },
      combine: q.combine ?? DEFAULT_CONFIG.quality.combine,
    },
    brilliant: { ...DEFAULT_CONFIG.brilliant, ...overrides.brilliant },
    great: { ...DEFAULT_CONFIG.great, ...overrides.great },
    miss: { ...DEFAULT_CONFIG.miss, ...overrides.miss },
    winProbability: { ...DEFAULT_CONFIG.winProbability, ...overrides.winProbability },
    lowDepthThreshold: overrides.lowDepthThreshold ?? DEFAULT_CONFIG.lowDepthThreshold,
    lowDepthConfidencePenalty:
      overrides.lowDepthConfidencePenalty ?? DEFAULT_CONFIG.lowDepthConfidencePenalty,
  };
}

/** Threshold set scaled for a phase. Rules never scale by hand. */
export function thresholdsFor(
  band: BandThresholds,
  phase: GamePhase,
  config: QualityBandConfig,
): BandThresholds {
  const m = config.phaseMultipliers[phase] ?? 1;
  return {
    winPctDrop: band.winPctDrop * m,
    centipawnLoss: band.centipawnLoss * m,
    evalSwing: band.evalSwing * m,
  };
}

/** Retained for callers that referenced it; {@link ClassifierConfigOverrides} is preferred. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? { [P in keyof T[K]]?: T[K][P] } : T[K];
};
