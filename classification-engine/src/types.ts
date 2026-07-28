/**
 * Core domain types for the move classification engine.
 *
 * Pipeline position:
 *
 *   PGN ─► Stockfish ─► **Move Classification** ─► Explanation Engine ─► UI
 *
 * This package owns stage 3 only. It performs no engine I/O and no board
 * search: it consumes one fully-analysed move ({@link MoveAnalysis}) and
 * returns a verdict ({@link MoveClassification}). That makes every decision
 * deterministic and unit-testable from a plain object.
 */

/** The side that played the move. */
export type Color = 'white' | 'black';

/** Coarse phase of the game, supplied by the host. */
export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** Every verdict this engine can return. */
export type Classification =
  | 'Book'
  | 'Forced'
  | 'Best'
  | 'Excellent'
  | 'Good'
  | 'Inaccuracy'
  | 'Mistake'
  | 'Blunder'
  | 'Great'
  | 'Brilliant'
  | 'Miss';

/** One engine line, used to measure how far ahead the best move was. */
export interface EngineLine {
  /** First move of the line, long algebraic ("g1f3"). */
  readonly move: string;
  /** Score in centipawns from WHITE's point of view. Null when mating. */
  readonly scoreCp: number | null;
  /** Moves to mate (positive = side to move mates). Null when not mating. */
  readonly mateIn: number | null;
}

/** What the host knows about the opening at this point. */
export interface OpeningInfo {
  /** True when the played move is still within the opening book. */
  readonly isBook: boolean;
  readonly name?: string;
  readonly eco?: string;
}

/**
 * Everything the classifier is allowed to look at for one move.
 *
 * All centipawn scores are from WHITE's point of view — the single convention
 * used throughout, so callers never have to guess. Conversion to the mover's
 * perspective happens once, in {@link ../context}.
 */
export interface MoveAnalysis {
  readonly fenBefore: string;
  readonly fenAfter: string;
  /** The move actually played, long algebraic ("e2e4"). */
  readonly playedMove: string;
  /** The engine's preferred move in the position before. */
  readonly bestMove: string;
  /** Evaluation of the position BEFORE the move (white POV, centipawns). */
  readonly evalBefore: number;
  /** Evaluation of the position AFTER the move (white POV, centipawns). */
  readonly evalAfter: number;
  /** Evaluation the engine expected after its own best move (white POV). */
  readonly bestEval: number;
  /** Centipawns given up versus best play, from the MOVER's point of view (>= 0). */
  readonly centipawnLoss: number;
  /** Mate distance before the move (white POV), or null. */
  readonly mateBefore: number | null;
  /** Mate distance after the move (white POV), or null. */
  readonly mateAfter: number | null;
  /** The engine's principal variation from the position before, in UCI. */
  readonly principalVariation: readonly string[];
  /** Search depth actually reached. */
  readonly depth: number;
  /** Every legal move in the position before, in UCI. */
  readonly legalMoves: readonly string[];
  readonly phase: GamePhase;
  readonly opening: OpeningInfo | null;
  /**
   * Which side played. Required: white-POV scores cannot be turned into
   * "did this player gain or lose?" without it.
   */
  readonly mover: Color;
  /** Ranked alternatives (MultiPV), best first. Optional but improves Great/Brilliant. */
  readonly alternatives?: readonly EngineLine[];
}

/** The verdict. */
export interface MoveClassification {
  readonly classification: Classification;
  /** How sure the engine is of this label, 0–1. */
  readonly confidence: number;
  /** Human-readable justifications, most important first. */
  readonly reasons: readonly string[];
  /** Derived numbers behind the decision — for debugging, telemetry and UI. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Clamp a number into [0, 1]. Shared so no rule re-implements it. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
