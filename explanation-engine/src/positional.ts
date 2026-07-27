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
  attackersOfSquares,
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

/* ────────────────────────── pawn structure ──────────────────────────
 * Atomic structural predicates shared by the pawn-structure detector.
 * Standard textbook definitions; each is pure geometry over the pawns.
 */

/** Squares of `color`'s pawns, sorted. */
export function pawnSquares(board: Board, color: Color): string[] {
  const out: string[] = [];
  for (const [sq, p] of board.squares) {
    if (p.color === color && p.type === 'p') out.push(sq);
  }
  return out.sort();
}

/** The two squares a pawn on `square` attacks (forward diagonals). */
export function pawnAttackSquares(square: string, color: Color): string[] {
  const f = fileIndex(square);
  const r = rankIndex(square);
  const dir = color === 'white' ? 1 : -1;
  const out: string[] = [];
  for (const df of [-1, 1]) {
    const s = squareAt(f + df, r + dir);
    if (s) out.push(s);
  }
  return out;
}

/** Is `square` attacked by one of the enemy's pawns? */
export function pawnAttackedByEnemyPawn(board: Board, square: string, color: Color): boolean {
  const enemy = otherColor(color);
  for (const [sq, p] of board.squares) {
    if (p.color === enemy && p.type === 'p' && pawnAttackSquares(sq, enemy).includes(square)) return true;
  }
  return false;
}

/** No friendly pawn on either adjacent file — the isolani. */
export function isIsolatedPawn(board: Board, square: string, color: Color): boolean {
  const f = fileIndex(square);
  for (const [sq, p] of board.squares) {
    if (p.color === color && p.type === 'p' && sq !== square && Math.abs(fileIndex(sq) - f) === 1) return false;
  }
  return true;
}

/** Files carrying two or more of `color`'s pawns. */
export function doubledPawnFiles(board: Board, color: Color): number[] {
  const counts = new Array(8).fill(0);
  for (const [sq, p] of board.squares) {
    if (p.color === color && p.type === 'p') counts[fileIndex(sq)]++;
  }
  const out: number[] = [];
  for (let f = 0; f < 8; f++) if (counts[f] >= 2) out.push(f);
  return out;
}

/** No enemy pawn on the same or adjacent files can stop this pawn from queening. */
export function isPassedPawn(board: Board, square: string, color: Color): boolean {
  const f = fileIndex(square);
  const r = rankIndex(square);
  const enemy = otherColor(color);
  for (const [sq, p] of board.squares) {
    if (p.color !== enemy || p.type !== 'p' || Math.abs(fileIndex(sq) - f) > 1) continue;
    const er = rankIndex(sq);
    if (color === 'white' ? er > r : er < r) return false; // an enemy pawn ahead can blockade/capture
  }
  return true;
}

/**
 * Backward pawn: it has a neighbour on an adjacent file but every such neighbour
 * has advanced PAST it (so no pawn can drop back to defend it), and the square
 * in front is covered by an enemy pawn (so it can't advance to catch up).
 */
export function isBackwardPawn(board: Board, square: string, color: Color): boolean {
  const f = fileIndex(square);
  const r = rankIndex(square);
  let hasNeighbour = false;
  for (const [sq, p] of board.squares) {
    if (p.color !== color || p.type !== 'p' || Math.abs(fileIndex(sq) - f) !== 1) continue;
    hasNeighbour = true;
    const nr = rankIndex(sq);
    if (color === 'white' ? nr <= r : nr >= r) return false; // a neighbour can support it → not backward
  }
  if (!hasNeighbour) return false; // no neighbours at all = isolated, not backward
  const stopRank = color === 'white' ? r + 1 : r - 1;
  const stop = squareAt(f, stopRank);
  return !!stop && pawnAttackedByEnemyPawn(board, stop, color);
}

/** Pawn chains (diagonally-linked groups of >=2 pawns) for `color`. */
export function pawnChains(board: Board, color: Color): string[][] {
  const pawns = pawnSquares(board, color);
  const set = new Set(pawns);
  const adj = new Map<string, string[]>(pawns.map((p) => [p, [] as string[]]));
  for (const a of pawns) {
    for (const t of pawnAttackSquares(a, color)) {
      if (set.has(t)) { adj.get(a)!.push(t); adj.get(t)!.push(a); }
    }
  }
  const seen = new Set<string>();
  const chains: string[][] = [];
  for (const start of pawns) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const y of adj.get(x)!) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    chains.push(comp);
  }
  return chains.filter((c) => c.length >= 2);
}

/** The base (rearmost pawn) of a chain for `color`. */
export function chainBase(chain: readonly string[], color: Color): string {
  return [...chain].sort((a, b) =>
    color === 'white' ? rankIndex(a) - rankIndex(b) : rankIndex(b) - rankIndex(a),
  )[0]!;
}

/** Pawn counts on the queenside (files a-c) and kingside (f-h). */
export function wingPawnCounts(board: Board, color: Color): { queenside: number; kingside: number } {
  let queenside = 0;
  let kingside = 0;
  for (const [sq, p] of board.squares) {
    if (p.color !== color || p.type !== 'p') continue;
    const f = fileIndex(sq);
    if (f <= 2) queenside++;
    else if (f >= 5) kingside++;
  }
  return { queenside, kingside };
}

/* ────────────────────────── centre control ──────────────────────────
 * The classical small centre — the four squares d4/e4/d5/e5 — and how much
 * of it a colour controls (occupies or attacks). Shared so the centre-control
 * detector (and any future space detector) agree on one definition.
 */

/** The four central squares. */
export const CENTER_SQUARES = ['d4', 'e4', 'd5', 'e5'] as const;

/** How many central squares `color` controls (occupies with a piece OR attacks). 0–4. */
export function centralControlCount(board: Board, color: Color): number {
  let n = 0;
  for (const sq of CENTER_SQUARES) {
    const occ = board.squares.get(sq);
    if ((occ && occ.color === color) || attackersOfSquares(board.squares, sq, color).length > 0) n++;
  }
  return n;
}

/** How many central squares `color` occupies with a PAWN. 0–4. */
export function centralPawnCount(board: Board, color: Color): number {
  let n = 0;
  for (const sq of CENTER_SQUARES) {
    const p = board.squares.get(sq);
    if (p && p.color === color && p.type === 'p') n++;
  }
  return n;
}
