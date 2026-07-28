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
  SignalDetector,
  TIER_RANK,
  type ArrowHint,
  type ConfidenceTier,
  type DetectionResult,
  type Detector,
  type Explanation,
  type HintColor,
  type Improvement,
  type SquareHint,
  type Visuals,
} from './detector';

export {
  isViewerMove,
  moverSubject,
  movers,
  moversLower,
  opponents,
  opponentsLower,
} from './perspective';

export { joinFiles, joinList, points } from './text';

export { boardsOf, type MoveBoards } from './context';

export { readMove, type MoveFacts } from './facts';
export { writeExplanation, ideaOf, type Subject, type Written } from './coach';

export {
  CRITIQUE_CLASSES,
  isCritiqueClass,
  isPraiseClass,
  POSITIONAL_CLASSES,
  PRAISE_CLASSES,
} from './classifications';

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
  applyUciMove,
  attacks,
  attackersOf,
  attackersOfSquares,
  attacksFrom,
  canCastle,
  describePiece,
  fileIndex,
  hangingPieces,
  isCaptureUci,
  isCastlingUci,
  isDevelopingUci,
  isHomeSquare,
  isInCheck,
  kingOnHome,
  kingSquareOf,
  kingZone,
  otherColor,
  parseFen,
  parseUciMove,
  pieceName,
  PIECE_VALUES,
  rankIndex,
  squareAt,
  squareColor,
  staticExchangeEval,
  toFen,
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
  bishopQuality,
  CENTER_SQUARES,
  centralControlCount,
  centralControlSquares,
  centralPawnCount,
  chainBase,
  doubledPawnFiles,
  isBackwardPawn,
  isIsolatedPawn,
  isOpenFile,
  isOutpostSquare,
  isPassedPawn,
  isSemiOpenFile,
  outpostSupported,
  ownPawnsOnColor,
  pawnAttackedByEnemyPawn,
  pawnAttackSquares,
  pawnChains,
  pawnsOnFile,
  pawnSquares,
  pieceMobility,
  rooksConnected,
  wingPawnCounts,
  type BishopQuality,
  type FilePawnCount,
} from './positional';

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

export {
  detectTactics,
  type MotifId,
  type TacticEngineInfo,
  type TacticFinding,
} from './tactics';

export {
  TacticalDetector,
  TacticalMotifDetector,
  tacticalDetectors,
} from './detectors/tactical';

export {
  computeActivitySignals,
  PieceActivityDetector,
  type ActivitySignals,
} from './detectors/piece-activity';

export {
  computeStructureSignals,
  PawnStructureDetector,
  type StructureSignals,
} from './detectors/pawn-structure';

export {
  computeCenterSignals,
  CenterControlDetector,
  centralLeverTargets,
  isCentralLever,
  type CenterSignals,
} from './detectors/center-control';

export {
  computeEndgameSignals,
  EndgameDetector,
  haveDirectOpposition,
  isEndgame,
  type EndgameSignals,
} from './detectors/endgame';
