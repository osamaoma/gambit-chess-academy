/**
 * Core domain types for the explanation engine.
 *
 * The pipeline this package serves:
 *
 *   PGN ──► Stockfish Analysis ──► Move Classification ──► Explanation Engine ──► User Explanation
 *
 * Stages 1–3 live OUTSIDE this package (the host app already has a PGN parser,
 * a Stockfish bridge and a classifier). This package defines the *ports* those
 * stages must satisfy ({@link AnalysisProvider}, {@link MoveClassifier}) and
 * consumes their combined output as a {@link MoveContext} — one fully-described
 * move, ready to be explained.
 */

/** The side that played the move under review. */
export type Color = 'white' | 'black';

/**
 * Every classification the review classifier can emit.
 * Mirrors the host app's Game Review categories exactly, so a classified move
 * can be handed to the engine without any mapping step.
 */
export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

/** One engine line (used for MultiPV alternatives). */
export interface EngineLine {
  /** First move of the line, long algebraic (e.g. "g1f3"). */
  readonly uci: string;
  /** Score in centipawns from White's point of view, or null when mating. */
  readonly scoreCp: number | null;
  /** Moves until mate (positive = the side to move mates), or null. */
  readonly mateIn: number | null;
  /** Principal variation as a UCI move list. */
  readonly pv: readonly string[];
}

/**
 * A single position's engine verdict — the atom produced by stage 2.
 * All scores are from WHITE's point of view; detectors that need the mover's
 * perspective should use the pre-computed {@link MoveDeltas} instead of
 * re-deriving signs (that conversion lives in one place, upstream).
 */
export interface EngineEval extends EngineLine {
  /** Search depth actually reached. */
  readonly depth: number;
  /** Ranked alternatives (MultiPV), best first. May be empty. */
  readonly alternatives: readonly EngineLine[];
}

/**
 * Pre-computed, mover-perspective differences between the position before and
 * after the move. Centralising these here is what keeps sign conversions and
 * win% math out of every individual detector (no duplicated logic).
 */
export interface MoveDeltas {
  /** Mover's eval (pawns) before the move, assuming best play. */
  readonly evalBefore: number;
  /** Mover's eval (pawns) after the move was played. */
  readonly evalAfter: number;
  /** Pawns of advantage the mover gave up versus best play (>= 0). */
  readonly evalLoss: number;
  /** Mover's win probability (0–100) before the move. */
  readonly winPctBefore: number;
  /** Mover's win probability (0–100) after the move. */
  readonly winPctAfter: number;
  /** Win% the mover gave up (>= 0). */
  readonly winPctDrop: number;
}

/** Optional, non-chess context that some detectors may want (clocks, opening). */
export interface MoveMeta {
  readonly openingName?: string;
  /** Seconds remaining on the mover's clock after the move. */
  readonly clockRemaining?: number;
  /** Seconds the mover spent on the move. */
  readonly timeSpent?: number;
  /**
   * The side the person reading the review played. When set, explanations
   * address them directly ("Your knight…" vs "Their knight…"); when omitted
   * they fall back to naming the colour ("White's knight…").
   */
  readonly viewerColor?: Color;
}

/**
 * Everything a detector may inspect about one move. Immutable by contract:
 * detectors receive the same shared instance and MUST NOT mutate it.
 */
export interface MoveContext {
  /** FEN of the position the move was played FROM. */
  readonly fenBefore: string;
  /** FEN of the position the move produced. */
  readonly fenAfter: string;
  /** The move in SAN ("Nf3") and long algebraic ("g1f3"). */
  readonly san: string;
  readonly uci: string;
  /** 1-based half-move index within the game. */
  readonly ply: number;
  readonly mover: Color;
  /** Engine verdict on the position before the move (its best line = the refutation/improvement). */
  readonly evalBefore: EngineEval;
  /** Engine verdict on the position after the move. */
  readonly evalAfter: EngineEval;
  /** What the classifier called this move. */
  readonly classification: MoveClassification;
  /** Mover-perspective deltas (see {@link MoveDeltas}). */
  readonly deltas: MoveDeltas;
  readonly meta?: MoveMeta;
}

/* ────────────────────────── Pipeline ports ──────────────────────────
 * The engine never talks to Stockfish or parses PGN itself. Hosts implement
 * these two interfaces with whatever they already have; the engine only needs
 * the resulting MoveContext objects. This keeps the package runnable in tests
 * with plain fakes and free of any engine/WASM dependency.
 */

/** Port for stage 2 — any UCI engine bridge can satisfy this. */
export interface AnalysisProvider {
  analyse(fen: string): Promise<EngineEval>;
}

/** Port for stage 3 — the host's move classifier. */
export interface MoveClassifier {
  classify(ctx: Omit<MoveContext, 'classification'>): MoveClassification;
}

/** Clamp a number into [0, 1]. Shared so no detector re-implements it. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
