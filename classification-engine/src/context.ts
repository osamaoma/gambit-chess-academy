/**
 * Derived metrics — computed once, read by every rule.
 *
 * Rules must not each re-derive "how much win% did the mover give up?" from raw
 * centipawns: that is duplicated logic and a sign-flip bug waiting to happen.
 * The conversion from WHITE-point-of-view scores to the MOVER's point of view
 * happens here, exactly once, and every rule consumes the result.
 */

import { ClassifierConfig } from './config';
import { winProbability } from './win-probability';
import { Color, MoveAnalysis } from './types';

/** Standard piece values in centipawns, used only for sacrifice detection. */
const PIECE_CP: Readonly<Record<string, number>> = {
  p: 100, n: 300, b: 320, r: 500, q: 900, k: 0,
};

/** Total material for one colour, read straight from a FEN board field. */
export function materialOf(fen: string, color: Color): number {
  const board = (fen ?? '').split(/\s+/)[0] ?? '';
  let total = 0;
  for (const ch of board) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const isWhite = ch === ch.toUpperCase();
    if ((color === 'white') !== isWhite) continue;
    total += PIECE_CP[ch.toLowerCase()] ?? 0;
  }
  return total;
}

/** Everything a rule may need, already in the mover's point of view. */
export interface ClassificationContext {
  readonly analysis: MoveAnalysis;
  /** Mover-perspective win probability (0–100) before the move, with best play. */
  readonly winPctBefore: number;
  /** Mover-perspective win probability (0–100) after the move actually played. */
  readonly winPctAfter: number;
  /** Win probability given up versus best play (>= 0). */
  readonly winPctDrop: number;
  /** Did the player pick the engine's first choice? */
  readonly playedBest: boolean;
  /** Only one legal move existed. */
  readonly onlyMove: boolean;
  /** Win% the best move beats the second-best alternative by; null when unknown. */
  readonly gapToSecondBest: number | null;
  /** Net material the mover invested with this move (positive = gave material up). */
  readonly sacrificedCp: number;
  /** The mover had a forced mate available before the move. */
  readonly hadForcedMate: boolean;
  /** The move delivers a forced mate for the mover. */
  readonly deliversMate: boolean;
  /** 1-based half-move index, derived from the FEN when the host omits it. */
  readonly ply: number;
}

/** Mover-perspective centipawns from a white-POV score. */
const toMover = (cp: number, mover: Color): number => (mover === 'white' ? cp : -cp);

/** Ply number from a FEN's fullmove counter + side to move. */
function plyOf(fen: string): number {
  const parts = (fen ?? '').split(/\s+/);
  const fullmove = Number(parts[5] ?? 1) || 1;
  const black = parts[1] === 'b';
  return (fullmove - 1) * 2 + (black ? 2 : 1);
}

/**
 * Build the context for one analysed move.
 *
 * Mate scores dominate centipawns: a position with mate-in-3 is not "900
 * centipawns", it is won, so the win-probability model is asked for a mate
 * value rather than being fed a synthetic score.
 */
export function buildContext(analysis: MoveAnalysis, config: ClassifierConfig): ClassificationContext {
  const { mover } = analysis;
  const wp = (cp: number, mate: number | null): number =>
    winProbability(toMover(cp, mover), mate == null ? null : toMover(mate, mover), config.winProbability);

  // "Before" is measured with BEST play, which is what the player could have had.
  const winPctBefore = wp(analysis.bestEval, analysis.mateBefore);
  const winPctAfter = wp(analysis.evalAfter, analysis.mateAfter);
  const winPctDrop = Math.max(0, winPctBefore - winPctAfter);

  const playedBest = normaliseMove(analysis.playedMove) === normaliseMove(analysis.bestMove);
  const onlyMove = analysis.legalMoves.length <= 1;

  // How far ahead was the top move? Needs MultiPV; null when the host omits it.
  let gapToSecondBest: number | null = null;
  const alts = analysis.alternatives;
  if (alts && alts.length >= 2) {
    const first = alts[0]!;
    const second = alts[1]!;
    const a = wp(first.scoreCp ?? 0, first.mateIn);
    const b = wp(second.scoreCp ?? 0, second.mateIn);
    gapToSecondBest = Math.max(0, a - b);
  }

  // A sacrifice is material the mover no longer has after the move — measured
  // on the board, never inferred from the evaluation.
  const mineBefore = materialOf(analysis.fenBefore, mover);
  const mineAfter = materialOf(analysis.fenAfter, mover);
  const theirsBefore = materialOf(analysis.fenBefore, mover === 'white' ? 'black' : 'white');
  const theirsAfter = materialOf(analysis.fenAfter, mover === 'white' ? 'black' : 'white');
  const netBefore = mineBefore - theirsBefore;
  const netAfter = mineAfter - theirsAfter;
  const sacrificedCp = Math.max(0, netBefore - netAfter);

  const mateBeforeMover = analysis.mateBefore == null ? null : toMover(analysis.mateBefore, mover);
  const mateAfterMover = analysis.mateAfter == null ? null : toMover(analysis.mateAfter, mover);

  return {
    analysis,
    winPctBefore,
    winPctAfter,
    winPctDrop,
    playedBest,
    onlyMove,
    gapToSecondBest,
    sacrificedCp,
    hadForcedMate: mateBeforeMover != null && mateBeforeMover > 0,
    deliversMate: mateAfterMover != null && mateAfterMover > 0,
    ply: plyOf(analysis.fenBefore),
  };
}

/** Compare moves on from/to (+promotion) only, ignoring notation noise. */
function normaliseMove(uci: string): string {
  return (uci ?? '').trim().toLowerCase().slice(0, 5);
}
