/**
 * @gambit/review-engine — modular game review.
 *
 * Nine modules, one responsibility each, composed by {@link ReviewPipeline}:
 *
 *  1. MoveClassifier          — @gambit/classification-engine
 *  2. ThemeDetector           — ./theme-detector
 *  3. TacticalMotifDetector   — ./tactical-motif-detector
 *  4. BestMoveComparator      — ./best-move-comparator
 *  5. ArrowGenerator          — ./arrow-generator
 *  6. HighlightGenerator      — ./highlight-generator
 *  7. ExplanationGenerator    — ./explanation (Gemini 2.5 Flash)
 *  8. ReviewPipeline          — ./review-pipeline
 *  9. PositionContextDetector — ./position-context-detector
 *
 * ```ts
 * const pipeline = new ReviewPipeline({
 *   explanations: new GeminiExplanationGenerator(
 *     new GeminiService({ apiKey: process.env.GEMINI_API_KEY! }),
 *   ),
 * });
 * const reviewed = await pipeline.reviewGame(analysedMoves);
 * ```
 *
 * Every module is injectable, so any one can be replaced without touching the
 * others. The package emits DATA only — no UI, no pixels, no colours.
 */

export { ReviewPipeline, type ReviewPipelineModules, type ReviewPipelineOptions } from './review-pipeline';

export { DefaultPositionContextDetector, DEFAULT_PHASE_CONFIG, plyOf, type PhaseConfig } from './position-context-detector';
export { DefaultBestMoveComparator } from './best-move-comparator';
export { DefaultTacticalMotifDetector, DEFAULT_MOTIF_CONFIG, type MotifConfig } from './tactical-motif-detector';

export {
  DefaultThemeDetector,
  DEFAULT_THEME_RULES,
  activityRule,
  centralControlRule,
  developmentRule,
  kingSafetyRule,
  materialRule,
  openFileRule,
  type ThemeContext,
  type ThemeRule,
} from './theme-detector';

export {
  DefaultStrategicPriorityDetector,
  DEFAULT_PRIORITY_RULES,
  activateKingRule,
  contestOpenFileRule,
  convertMaterialRule,
  finishDevelopmentRule,
  kingToSafetyRule,
  seekCounterplayRule,
  type PriorityContext,
  type PriorityRule,
  type StrategicPriorityDetector,
} from './strategic-priority-detector';

export {
  DefaultArrowGenerator,
  DEFAULT_ARROW_CONFIG,
  DEFAULT_ARROW_RULES,
  bestMoveArrowRule,
  motifArrowRule,
  type ArrowConfig,
  type ArrowRule,
} from './arrow-generator';

export {
  DefaultHighlightGenerator,
  DEFAULT_HIGHLIGHT_CONFIG,
  DEFAULT_HIGHLIGHT_RULES,
  bestSquareRule,
  motifSquareRule,
  themeSquareRule,
  type HighlightConfig,
  type HighlightRule,
} from './highlight-generator';

export * from './explanation';

export type {
  Arrow,
  ArrowGenerator,
  BestMoveComparator,
  Color,
  Explanation,
  ExplanationGenerator,
  ExplanationInput,
  GamePhase,
  Highlight,
  HighlightGenerator,
  HintColor,
  Motif,
  MoveClassifierPort,
  MoveComparison,
  PositionContext,
  PositionContextDetector,
  ReviewInput,
  ReviewedMove,
  StrategicPriority,
  TacticalMotifDetector,
  Theme,
  ThemeDetector,
} from './types';
