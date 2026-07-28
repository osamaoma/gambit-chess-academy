/**
 * Every tunable number in the engine.
 *
 * This file is the ONLY place a threshold may live. Rules read values from the
 * config they are handed and never inline a constant, so a product decision
 * ("blunders should start at 250cp for beginners") is a config change, not a
 * code change — and A/B testing or per-rating-band tuning needs no new code.
 *
 * The defaults below are tuned to feel like a mainstream online review: most
 * moves land on Good/Excellent, Blunder is reserved for genuinely game-changing
 * errors, and Brilliant stays rare enough to mean something.
 */

/** Bands for the routine quality verdicts, measured in win-probability lost. */
export interface QualityBandConfig {
  /** Max win% drop still called Excellent. */
  readonly excellent: number;
  /** Max win% drop still called Good. */
  readonly good: number;
  /** Max win% drop still called Inaccuracy. */
  readonly inaccuracy: number;
  /** Max win% drop still called Mistake; anything worse is a Blunder. */
  readonly mistake: number;
}

/** When a move may be called Brilliant. */
export interface BrilliantConfig {
  /** Minimum material (centipawns) the move must give up. */
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
  /** Require at least this search depth. */
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
  /**
   * Logistic steepness. Lichess-style default (0.00368 per centipawn) — larger
   * values make the model treat small evaluation swings as more decisive.
   */
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

export const DEFAULT_CONFIG: ClassifierConfig = {
  quality: {
    excellent: 2,
    good: 5,
    inaccuracy: 10,
    mistake: 20,
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

/** Deep-merge a partial override onto the defaults. */
export function resolveConfig(overrides: DeepPartial<ClassifierConfig> = {}): ClassifierConfig {
  return {
    quality: { ...DEFAULT_CONFIG.quality, ...overrides.quality },
    brilliant: { ...DEFAULT_CONFIG.brilliant, ...overrides.brilliant },
    great: { ...DEFAULT_CONFIG.great, ...overrides.great },
    miss: { ...DEFAULT_CONFIG.miss, ...overrides.miss },
    winProbability: { ...DEFAULT_CONFIG.winProbability, ...overrides.winProbability },
    lowDepthThreshold: overrides.lowDepthThreshold ?? DEFAULT_CONFIG.lowDepthThreshold,
    lowDepthConfidencePenalty:
      overrides.lowDepthConfidencePenalty ?? DEFAULT_CONFIG.lowDepthConfidencePenalty,
  };
}

/** One level of partiality per nested section — enough for config overrides. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
