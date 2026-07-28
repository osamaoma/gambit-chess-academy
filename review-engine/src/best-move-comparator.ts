/**
 * Module 4 — BestMoveComparator.
 *
 * Answers "how does what you played relate to what was best?". This is a
 * comparison of two MOVES, not a judgement of either, and keeping it separate
 * is what lets the writer say useful things like "right piece, wrong square"
 * instead of only "that was not the best move".
 */

import { applyUciMove, isInCheck, otherColor, parseUciMove, pieceName } from '@gambit/explanation-engine';
import type { Board } from '@gambit/explanation-engine';
import { parseFen } from '@gambit/explanation-engine';
import type { BestMoveComparator, MoveComparison } from './types';

/** Compare on from/to (+promotion), ignoring notation differences. */
const key = (uci: string): string => (uci ?? '').trim().toLowerCase().slice(0, 5);

export class DefaultBestMoveComparator implements BestMoveComparator {
  compare(fenBefore: string, played: string, best: string): MoveComparison | null {
    let board: Board;
    try { board = parseFen(fenBefore); } catch { return null; }

    const p = safeParse(played);
    const b = safeParse(best);
    if (!p || !b) return null;

    const playedPiece = board.squares.get(p.from)?.type ?? null;
    const bestPiece = board.squares.get(b.from)?.type ?? null;
    const bestTarget = board.squares.get(b.to);
    const mover = board.sideToMove;

    return {
      played,
      best,
      isSameMove: key(played) === key(best),
      // Same piece, different destination — "right idea, wrong square".
      movesSamePiece: p.from === b.from && p.to !== b.to,
      sharesDestination: p.to === b.to && p.from !== b.from,
      bestCaptures: !!bestTarget && bestTarget.color !== mover,
      bestGivesCheck: givesCheck(board, best),
      playedPiece: playedPiece ? pieceName(playedPiece) : null,
      bestPiece: bestPiece ? pieceName(bestPiece) : null,
    };
  }
}

function safeParse(uci: string): { from: string; to: string } | null {
  try {
    const { from, to } = parseUciMove(uci);
    return { from, to };
  } catch {
    return null;
  }
}

/** Would this move leave the opponent in check? */
function givesCheck(board: Board, uci: string): boolean {
  try {
    return isInCheck(applyUciMove(board, uci), otherColor(board.sideToMove));
  } catch {
    return false;
  }
}
