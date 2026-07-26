/**
 * @gambit/explanation-engine — public API.
 *
 * Typical host wiring:
 * ```ts
 * import { DetectorRegistry, ExplanationEngine, ExplanationSelector } from '@gambit/explanation-engine';
 *
 * const registry = new DetectorRegistry()
 *   .register(new HangingPieceDetector())     // concrete detectors ship separately
 *   .register(new BackRankDetector());
 *
 * const engine = new ExplanationEngine(registry, new ExplanationSelector({ maxSupporting: 1 }));
 * const explanation = engine.explainMove(moveContext);   // null → use classifier's stock note
 * ```
 */

export {
  clamp01,
  type AnalysisProvider,
  type Color,
  type EngineEval,
  type EngineLine,
  type MoveClassification,
  type MoveClassifier,
  type MoveContext,
  type MoveDeltas,
  type MoveMeta,
} from './types';

export {
  BaseDetector,
  detectorHandles,
  TIER_RANK,
  type ConfidenceTier,
  type DetectionResult,
  type Detector,
  type Explanation,
  type Improvement,
} from './detector';

export { DetectorRegistry } from './registry';

export {
  compareResults,
  DEFAULT_SELECTION_CONFIG,
  ExplanationSelector,
  type Selection,
  type SelectionConfig,
} from './selector';

export { ExplanationEngine, type UserExplanation } from './engine';
