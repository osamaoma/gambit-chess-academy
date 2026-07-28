/**
 * Shared contracts for the review engine.
 *
 * Each of the nine modules is defined here as an INTERFACE first and supplied
 * with a default implementation elsewhere. That is what makes the engine
 * extendable: swapping in a different theme detector, a house arrow style or a
 * new explanation voice means passing a different object to the pipeline —
 * never editing the pipeline itself.
 *
 * No module renders anything. The output is data; drawing it is the host's job.
 */

import type { MoveAnalysis, MoveClassification } from '@gambit/classification-engine';
import type { Board } from '@gambit/explanation-engine';

export type Color = 'white' | 'black';
export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/* ────────────────────────────── 1. Position context ────────────────────────── */

/** Facts about the position a move was played in, independent of the move. */
export interface PositionContext {
  readonly phase: GamePhase;
  /** Material for each side in centipawns, and the mover's net balance. */
  readonly material: { readonly white: number; readonly black: number; readonly moverNet: number };
  /** Files with no pawns of either colour. */
  readonly openFiles: readonly string[];
  /** Files with no pawn of the mover's colour. */
  readonly halfOpenFiles: readonly string[];
  /** Is each king still on its starting square? */
  readonly kingsOnHome: { readonly white: boolean; readonly black: boolean };
  /** Total non-pawn material, the usual phase signal. */
  readonly nonPawnMaterial: number;
  /** 1-based half-move index. */
  readonly ply: number;
}

export interface PositionContextDetector {
  detect(fen: string, mover: Color): PositionContext;
}

/* ────────────────────────────── 2. Best-move comparison ────────────────────── */

/** How the played move relates to the engine's choice. */
export interface MoveComparison {
  readonly played: string;
  readonly best: string;
  /** Same from- and to-square (ignoring promotion piece). */
  readonly isSameMove: boolean;
  /** Both moves move the same piece, but somewhere else. */
  readonly movesSamePiece: boolean;
  /** Both moves land on the same square. */
  readonly sharesDestination: boolean;
  /** The best move captures something the played move did not. */
  readonly bestCaptures: boolean;
  /** The best move gives check. */
  readonly bestGivesCheck: boolean;
  /** Piece types involved, for wording. */
  readonly playedPiece: string | null;
  readonly bestPiece: string | null;
}

export interface BestMoveComparator {
  compare(fenBefore: string, played: string, best: string): MoveComparison | null;
}

/* ────────────────────────────── 3. Themes ──────────────────────────────────── */

/** A strategic idea present in the move, named and scored. */
export interface Theme {
  /** Stable kebab-case id ("king-safety", "central-control"). */
  readonly id: string;
  /** Human label for grouping in the UI. */
  readonly label: string;
  /** 0–1: how strongly this theme applies. */
  readonly weight: number;
  /** Squares that evidence the theme, if any. */
  readonly squares?: readonly string[];
}

export interface ThemeDetector {
  detect(input: ReviewInput, context: PositionContext): readonly Theme[];
}

/* ────────────────────────────── 4. Tactical motifs ─────────────────────────── */

export interface Motif {
  readonly id: string;
  readonly label: string;
  readonly confidence: number;
  /** Whether the motif is in the move played, or only in the move missed. */
  readonly source: 'played' | 'best';
  readonly squares?: readonly string[];
}

export interface TacticalMotifDetector {
  detect(input: ReviewInput): readonly Motif[];
}

/* ────────────────────────────── 5. Classification ──────────────────────────── */

export interface MoveClassifierPort {
  classify(analysis: MoveAnalysis): MoveClassification;
}

/* ────────────────────────────── 6. Explanation ─────────────────────────────── */

/**
 * A plan the position calls for, decided by THIS engine — never by a language
 * model. Passing priorities in explicitly is what stops the writer inventing
 * chess advice of its own.
 */
export interface StrategicPriority {
  readonly id: string;
  /** Imperative, e.g. "finish development", "challenge the d5 outpost". */
  readonly statement: string;
  /** 0–1 — how urgent this is compared with the other priorities. */
  readonly weight: number;
}

/** Everything the writer may quote. All chess judgements are already made. */
export interface ExplanationInput {
  readonly input: ReviewInput;
  readonly context: PositionContext;
  readonly classification: MoveClassification;
  readonly comparison: MoveComparison | null;
  readonly themes: readonly Theme[];
  readonly motifs: readonly Motif[];
  readonly priorities: readonly StrategicPriority[];
  /**
   * Summaries already shown earlier in this review. The writer is asked to
   * avoid echoing them, which is what keeps a 40-move review from reading like
   * the same sentence forty times.
   */
  readonly recentSummaries?: readonly string[];
}

export interface Explanation {
  /** One or two short sentences for the review card. Under 80 words. */
  readonly summary: string;
  /** Optional longer coaching text. */
  readonly detail?: string;
  /** Where the text came from — useful when a fallback was used. */
  readonly source?: 'model' | 'cache' | 'fallback';
}

/**
 * Asynchronous: the production implementation calls a hosted model. Any
 * synchronous implementation simply returns a resolved promise.
 */
export interface ExplanationGenerator {
  generate(input: ExplanationInput): Promise<Explanation>;
}

/* ────────────────────────────── 7/8. Visuals ───────────────────────────────── */

/** Semantic colours. The host maps these to pixels; this package never does. */
export type HintColor = 'idea' | 'threat' | 'best' | 'context';

export interface Arrow {
  readonly from: string;
  readonly to: string;
  readonly color: HintColor;
  /** Why this arrow exists — keeps visuals honest and debuggable. */
  readonly reason: string;
}

export interface Highlight {
  readonly square: string;
  readonly color: HintColor;
  readonly reason: string;
}

/** Both generators see the same evidence the explanation did. */
export interface VisualInput extends ExplanationInput {
  readonly explanation: Explanation;
}

export interface ArrowGenerator {
  generate(input: VisualInput): readonly Arrow[];
}

export interface HighlightGenerator {
  generate(input: VisualInput): readonly Highlight[];
}

/* ────────────────────────────── 9. Pipeline I/O ────────────────────────────── */

/** One move, fully analysed by the host's engine, ready to be reviewed. */
export interface ReviewInput {
  readonly analysis: MoveAnalysis;
  /** Parsed boards, supplied so every module shares one parse. */
  readonly boards: { readonly before: Board; readonly after: Board };
}

/** The finished review of one move. */
export interface ReviewedMove {
  readonly ply: number;
  readonly san: string;
  readonly uci: string;
  readonly mover: Color;
  readonly classification: MoveClassification;
  readonly context: PositionContext;
  readonly comparison: MoveComparison | null;
  readonly themes: readonly Theme[];
  readonly motifs: readonly Motif[];
  readonly explanation: Explanation;
  readonly arrows: readonly Arrow[];
  readonly highlights: readonly Highlight[];
}
