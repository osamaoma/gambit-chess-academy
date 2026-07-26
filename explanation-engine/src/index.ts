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

export {
  attacks,
  attackersOf,
  attackersOfSquares,
  attacksFrom,
  canCastle,
  describePiece,
  hangingPieces,
  isCaptureUci,
  isCastlingUci,
  isDevelopingUci,
  isHomeSquare,
  kingOnHome,
  kingSquareOf,
  kingZone,
  otherColor,
  parseFen,
  parseUciMove,
  pieceName,
  PIECE_VALUES,
  staticExchangeEval,
  undevelopedMinors,
  type Board,
  type HangingInfo,
  type HangReason,
  type Piece,
  type PieceType,
  type Squares,
  type UciMove,
} from './board';

export {
  computeDevelopmentSignals,
  DEFAULT_DEVELOPMENT_CONFIG,
  DevelopmentDetector,
  type DevelopmentDetectorConfig,
  type DevelopmentSignals,
} from './detectors/development';

export {
  computeHangingSignals,
  HangingPieceDetector,
  type HangingSignals,
} from './detectors/hanging-piece';

export {
  computeMaterialSignals,
  MaterialDetector,
  type MaterialKind,
  type MaterialSignals,
} from './detectors/material';

export {
  analyzeKingSafety,
  computeKingSafetySignals,
  KingSafetyDetector,
  type KingSafety,
  type KingSafetySignals,
} from './detectors/king-safety';
