/**
 * Positional geometry shared by the strategic detectors.
 *
 * Where {@link ./board} answers raw questions ("what attacks e5?"), this module
 * answers positional ones ("how active is this piece?", "is this a good
 * bishop?", "is that square an outpost?"). Pure and dependency-free, so any
 * detector — piece activity today, pawn structure or space tomorrow — can share
 * the same definitions instead of re-deriving them.
 */

import {
  attacksFrom,
  Board,
  fileIndex,
  otherColor,
  rankIndex,
  squareAt,
  squareColor,
} from './board';
import { Color } from './types';

/**
 * How many squares a piece can move to right now (empty squares + enemy
 * captures). A simple, robust activity proxy: a boxed-in rook scores low, a
 * centralised queen scores high. Sliders that only "see" their own pawns count
 * those blockers as non-moves.
 */
export function pieceMobility(board: Board, square: string): number {
  const piece = board.squares.get(square);
  if (!piece) return 0;
  let n = 0;
  for (const target of attacksFrom(board.squares, square)) {
    const occ = board.squares.get(target);
    if (!occ || occ.color !== piece.color) n++;
  }
  return n;
}

export interface FilePawnCount {
  readonly white: number;
  readonly black: number;
}

/** Pawns of each colour on a file (0-based index). */
export function pawnsOnFile(board: Board, file: number): FilePawnCount {
  let white = 0;
  let black = 0;
  for (const [sq, p] of board.squares) {
    if (p.type !== 'p' || fileIndex(sq) !== file) continue;
    if (p.color === 'white') white++;
    else black++;
  }
  return { white, black };
}

/** A file with no pawns of either colour — a rook highway. */
export function isOpenFile(board: Board, file: number): boolean {
  const { white, black } = pawnsOnFile(board, file);
  return white === 0 && black === 0;
}

/** A file with none of `color`'s OWN pawns (may still hold enemy pawns). */
export function isSemiOpenFile(board: Board, file: number, color: Color): boolean {
  const { white, black } = pawnsOnFile(board, file);
  return (color === 'white' ? white : black) === 0;
}

/** Count of `color`'s pawns sitting on squares of the given colour. */
export function ownPawnsOnColor(board: Board, color: Color, sqColor: 'light' | 'dark'): number {
  let n = 0;
  for (const [sq, p] of board.squares) {
    if (p.color === color && p.type === 'p' && squareColor(sq) === sqColor) n++;
  }
  return n;
}

export type BishopQuality = 'bad' | 'ok' | 'good';

/**
 * Classify a bishop by the classic rule of thumb:
 *  - `bad`  — hemmed in by a mass of its OWN pawns on its square colour (≥4);
 *  - `good` — few own pawns in its way (≤2) and long open diagonals (mobility ≥7);
 *  - `ok`   — anything between.
 */
export function bishopQuality(board: Board, square: string): BishopQuality {
  const piece = board.squares.get(square);
  if (!piece || piece.type !== 'b') return 'ok';
  const onColor = ownPawnsOnColor(board, piece.color, squareColor(square));
  if (onColor >= 4) return 'bad';
  if (onColor <= 2 && pieceMobility(board, square) >= 7) return 'good';
  return 'ok';
}

/**
 * Is `square` an outpost for `color`? — a square in the enemy's half that no
 * enemy pawn can ever attack (none on the adjacent files able to advance onto
 * the attacking diagonals). Whether it is currently occupied is not required;
 * pawn SUPPORT is checked separately by {@link outpostSupported}.
 */
export function isOutpostSquare(board: Board, square: string, color: Color): boolean {
  const f = fileIndex(square);
  const r = rankIndex(square);
  const inEnemyHalf = color === 'white' ? r >= 4 && r <= 6 : r >= 3 && r <= 5;
  if (!inEnemyHalf) return false;
  const enemy = otherColor(color);
  for (const [sq, p] of board.squares) {
    if (p.color !== enemy || p.type !== 'p' || Math.abs(fileIndex(sq) - f) !== 1) continue;
    // an enemy pawn "in front" on an adjacent file can advance to challenge the square
    if (color === 'white' && rankIndex(sq) > r) return false;
    if (color === 'black' && rankIndex(sq) < r) return false;
  }
  return true;
}

/** Is `square` defended by one of `color`'s pawns? (a real outpost is supported) */
export function outpostSupported(board: Board, square: string, color: Color): boolean {
  const f = fileIndex(square);
  const behind = color === 'white' ? rankIndex(square) - 1 : rankIndex(square) + 1;
  for (const df of [-1, 1]) {
    const s = squareAt(f + df, behind);
    if (!s) continue;
    const p = board.squares.get(s);
    if (p && p.color === color && p.type === 'p') return true;
  }
  return false;
}

/** Do two of the colour's rooks defend each other (connected on a clear line)? */
export function rooksConnected(board: Board, color: Color): boolean {
  const rooks: string[] = [];
  for (const [sq, p] of board.squares) {
    if (p.color === color && p.type === 'r') rooks.push(sq);
  }
  for (let i = 0; i < rooks.length; i++) {
    for (let j = i + 1; j < rooks.length; j++) {
      if (attacksFrom(board.squares, rooks[i]!).includes(rooks[j]!)) return true;
    }
  }
  return false;
}
