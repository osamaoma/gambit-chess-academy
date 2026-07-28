/**
 * Module 8 — ReviewPipeline.
 *
 * Composition only. It owns no chess knowledge, no thresholds and no wording:
 * its single responsibility is running the modules in the right order and
 * assembling one {@link ReviewedMove}.
 *
 * The order is not arbitrary — each stage consumes the ones before it:
 *
 *   position context → classification → best-move comparison
 *        → motifs → themes → priorities        (all analysis complete here)
 *        → explanation                         (writing, from settled facts)
 *        → arrows + highlights                 (visuals, from the same facts)
 *
 * Every collaborator is injected, so any of the nine can be swapped for a
 * different implementation without touching this file. That is the whole
 * extensibility story of the package.
 */

import { parseFen } from '@gambit/explanation-engine';
import type { Board } from '@gambit/explanation-engine';
import type { MoveAnalysis } from '@gambit/classification-engine';
import { MoveClassifier } from '@gambit/classification-engine';
import { DefaultPositionContextDetector } from './position-context-detector';
import { DefaultBestMoveComparator } from './best-move-comparator';
import { DefaultTacticalMotifDetector } from './tactical-motif-detector';
import { DefaultThemeDetector } from './theme-detector';
import {
  DefaultStrategicPriorityDetector,
  StrategicPriorityDetector,
} from './strategic-priority-detector';
import { DefaultArrowGenerator } from './arrow-generator';
import { DefaultHighlightGenerator } from './highlight-generator';
import type {
  ArrowGenerator,
  BestMoveComparator,
  Explanation,
  ExplanationGenerator,
  ExplanationInput,
  HighlightGenerator,
  MoveClassifierPort,
  PositionContextDetector,
  ReviewInput,
  ReviewedMove,
  TacticalMotifDetector,
  ThemeDetector,
} from './types';

/** Every module the pipeline runs. Omit any to accept the default. */
export interface ReviewPipelineModules {
  readonly classifier?: MoveClassifierPort;
  readonly positionContext?: PositionContextDetector;
  readonly comparator?: BestMoveComparator;
  readonly motifs?: TacticalMotifDetector;
  readonly themes?: ThemeDetector;
  readonly priorities?: StrategicPriorityDetector;
  readonly explanations?: ExplanationGenerator;
  readonly arrows?: ArrowGenerator;
  readonly highlights?: HighlightGenerator;
}

export interface ReviewPipelineOptions {
  /**
   * How many previous notes to show the writer so it can avoid repeating
   * itself across a game.
   */
  readonly recentSummaryWindow?: number;
  /** Surfaces a failed explanation without aborting the review. */
  readonly onExplanationError?: (error: unknown, ply: number) => void;
}

/** Returned when no explanation generator is configured or generation failed. */
const NO_EXPLANATION: Explanation = { summary: '' };

export class ReviewPipeline {
  private readonly classifier: MoveClassifierPort;
  private readonly positionContext: PositionContextDetector;
  private readonly comparator: BestMoveComparator;
  private readonly motifs: TacticalMotifDetector;
  private readonly themes: ThemeDetector;
  private readonly priorities: StrategicPriorityDetector;
  private readonly explanations: ExplanationGenerator | null;
  private readonly arrows: ArrowGenerator;
  private readonly highlights: HighlightGenerator;

  constructor(modules: ReviewPipelineModules = {}, private readonly options: ReviewPipelineOptions = {}) {
    this.classifier = modules.classifier ?? new MoveClassifier();
    this.positionContext = modules.positionContext ?? new DefaultPositionContextDetector();
    this.comparator = modules.comparator ?? new DefaultBestMoveComparator();
    this.motifs = modules.motifs ?? new DefaultTacticalMotifDetector();
    this.themes = modules.themes ?? new DefaultThemeDetector();
    this.priorities = modules.priorities ?? new DefaultStrategicPriorityDetector();
    // No default: explanations need a configured model, and silently inventing
    // one would hide a wiring mistake.
    this.explanations = modules.explanations ?? null;
    this.arrows = modules.arrows ?? new DefaultArrowGenerator();
    this.highlights = modules.highlights ?? new DefaultHighlightGenerator();
  }

  /**
   * Review one move.
   *
   * @param recentSummaries Notes already produced earlier in this game, so the
   *                        writer can avoid echoing them.
   */
  async reviewMove(analysis: MoveAnalysis, recentSummaries: readonly string[] = []): Promise<ReviewedMove> {
    const boards = this.parseBoards(analysis);
    const input: ReviewInput = { analysis, boards };

    // ── Analysis. Everything below this block is settled fact. ──
    const context = this.positionContext.detect(analysis.fenBefore, analysis.mover);
    const classification = this.classifier.classify(analysis);
    const comparison = this.comparator.compare(analysis.fenBefore, analysis.playedMove, analysis.bestMove);
    const motifs = this.motifs.detect(input);
    const themes = this.themes.detect(input, context);
    const priorities = this.priorities.detect(boards.before, analysis.mover, context);

    const explanationInput: ExplanationInput = {
      input, context, classification, comparison, themes, motifs, priorities,
      recentSummaries: recentSummaries.slice(-(this.options.recentSummaryWindow ?? 6)),
    };

    // ── Writing. Cannot change any conclusion above. ──
    const explanation = await this.explain(explanationInput, context.ply);

    // ── Visuals, from the same evidence the writer saw. ──
    const visualInput = { ...explanationInput, explanation };
    const arrows = this.arrows.generate(visualInput);
    const highlights = this.highlights.generate(visualInput);

    return {
      ply: context.ply,
      san: analysis.playedMove,
      uci: analysis.playedMove,
      mover: analysis.mover,
      classification, context, comparison, themes, motifs, priorities,
      explanation, arrows, highlights,
    };
  }

  /**
   * Review a whole game, threading each note into the next call so the writing
   * does not repeat itself. Sequential by design: the anti-repetition context
   * only exists if earlier moves have already been written.
   */
  async reviewGame(moves: readonly MoveAnalysis[]): Promise<ReviewedMove[]> {
    const out: ReviewedMove[] = [];
    const summaries: string[] = [];
    for (const move of moves) {
      const reviewed = await this.reviewMove(move, summaries);
      out.push(reviewed);
      if (reviewed.explanation.summary) summaries.push(reviewed.explanation.summary);
    }
    return out;
  }

  /** A failed note must never abort a review; the rest of the data is still good. */
  private async explain(input: ExplanationInput, ply: number): Promise<Explanation> {
    if (!this.explanations) return NO_EXPLANATION;
    try {
      return await this.explanations.generate(input);
    } catch (error) {
      this.options.onExplanationError?.(error, ply);
      return NO_EXPLANATION;
    }
  }

  /** Parsed once and shared, so no module re-parses the same FEN. */
  private parseBoards(analysis: MoveAnalysis): { before: Board; after: Board } {
    const before = parseFen(analysis.fenBefore);
    let after: Board;
    try { after = parseFen(analysis.fenAfter); } catch { after = before; }
    return { before, after };
  }
}
