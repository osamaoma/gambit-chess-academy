/**
 * @gambit/classification-engine — public API.
 *
 * ```ts
 * import { MoveClassifier } from '@gambit/classification-engine';
 *
 * const classifier = new MoveClassifier();          // or pass threshold overrides
 * const verdict = classifier.classify(analysis);    // always returns a label
 * // → { classification: 'Blunder', confidence: 0.9, reasons: [...], metadata: {...} }
 * ```
 *
 * Its output feeds straight into the explanation engine, which turns a verdict
 * plus a position into words for the user.
 */

export { MoveClassifier, defaultRules } from './classifier';

export {
  DEFAULT_CONFIG,
  resolveConfig,
  type BrilliantConfig,
  type ClassifierConfig,
  type DeepPartial,
  type GreatConfig,
  type MissConfig,
  type QualityBandConfig,
  type WinProbabilityConfig,
} from './config';

export { buildContext, materialOf, type ClassificationContext } from './context';

export {
  attacksFrom,
  materialFor,
  offeredMaterial,
  parseBoard,
  PIECE_CP,
  type Piece,
  type Squares,
} from './board';

export { winProbability } from './win-probability';

export type { ClassificationRule, RuleVerdict } from './rule';

export { BookRule, ForcedRule } from './rules/opening-rules';
export { BestRule, BrilliantRule, GreatRule } from './rules/excellence-rules';
export { MissRule, QualityBandRule } from './rules/error-rules';

export {
  clamp01,
  type Classification,
  type Color,
  type EngineLine,
  type GamePhase,
  type MoveAnalysis,
  type MoveClassification,
  type OpeningInfo,
} from './types';
