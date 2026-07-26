/**
 * Minimal, dependency-free board utilities shared by detectors.
 *
 * This is NOT a chess engine — legality, check detection and search all happen
 * upstream (Stockfish). Detectors only need cheap, pure structural facts about
 * a FEN: what sits where, what is still on its home square, whether a UCI move
 * castles / captures / develops. Keeping those answers here (once) is what
 * stops every detector from re-implementing FEN parsing.
 */

import { Color } from './types';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

/** A parsed FEN — only the fields detectors need. */
export interface Board {
  /** Map of occupied squares ("e4") to pieces. */
  readonly squares: ReadonlyMap<string, Piece>;
  readonly sideToMove: Color;
  /** Remaining castling rights: subset of "KQkq" ("" = none). */
  readonly castling: string;
}

/** A UCI move split into parts ("g1f3", "e7e8q"). */
export interface UciMove {
  readonly from: string;
  readonly to: string;
  readonly promotion?: PieceType;
}

const FILES = 'abcdefgh';
const PIECE_LETTERS = 'pnbrqk';

/** Parse the fields of a FEN we care about. Throws on malformed input. */
export function parseFen(fen: string): Board {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0];
  const active = parts[1];
  const castling = parts[2];
  if (!placement || (active !== 'w' && active !== 'b')) {
    throw new Error(`Malformed FEN: "${fen}"`);
  }
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`Malformed FEN placement: "${placement}"`);

  const squares = new Map<string, Piece>();
  ranks.forEach((rankStr, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rankStr) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (!PIECE_LETTERS.includes(lower) || file > 7) {
        throw new Error(`Malformed FEN rank "${rankStr}" in "${fen}"`);
      }
      squares.set(FILES.charAt(file) + String(rank), {
        color: ch === lower ? 'black' : 'white',
        type: lower as PieceType,
      });
      file++;
    }
  });

  return {
    squares,
    sideToMove: active === 'w' ? 'white' : 'black',
    castling: !castling || castling === '-' ? '' : castling,
  };
}

/** Parse and validate a UCI move string. Throws on malformed input. */
export function parseUciMove(uci: string): UciMove {
  if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(uci)) {
    throw new Error(`Malformed UCI move: "${uci}"`);
  }
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? (uci.charAt(4) as PieceType) : undefined,
  };
}

/** Starting squares per colour and piece type — the reference for "developed". */
const HOME: Record<Color, Readonly<Partial<Record<PieceType, readonly string[]>>>> = {
  white: { n: ['b1', 'g1'], b: ['c1', 'f1'], r: ['a1', 'h1'], q: ['d1'], k: ['e1'] },
  black: { n: ['b8', 'g8'], b: ['c8', 'f8'], r: ['a8', 'h8'], q: ['d8'], k: ['e8'] },
};

export function isHomeSquare(color: Color, type: PieceType, square: string): boolean {
  return (HOME[color][type] ?? []).includes(square);
}

/** Squares of the colour's knights/bishops still sitting on their home squares. */
export function undevelopedMinors(board: Board, color: Color): string[] {
  const out: string[] = [];
  for (const [sq, piece] of board.squares) {
    if (piece.color !== color) continue;
    if (piece.type !== 'n' && piece.type !== 'b') continue;
    if (isHomeSquare(color, piece.type, sq)) out.push(sq);
  }
  return out.sort();
}

/** Is the colour's king still on its starting square? */
export function kingOnHome(board: Board, color: Color): boolean {
  const home = color === 'white' ? 'e1' : 'e8';
  const piece = board.squares.get(home);
  return !!piece && piece.type === 'k' && piece.color === color;
}

/** Does the colour still hold at least one castling right? */
export function canCastle(board: Board, color: Color): boolean {
  return color === 'white'
    ? board.castling.includes('K') || board.castling.includes('Q')
    : board.castling.includes('k') || board.castling.includes('q');
}

/** Does this UCI move capture something on the target square? (En passant ignored — close enough for principle detectors.) */
export function isCaptureUci(board: Board, uci: string): boolean {
  const { from, to } = parseUciMove(uci);
  const mover = board.squares.get(from);
  const target = board.squares.get(to);
  return !!mover && !!target && target.color !== mover.color;
}

/** Is this UCI move castling (king moves two files off its home square)? */
export function isCastlingUci(board: Board, uci: string): boolean {
  const { from, to } = parseUciMove(uci);
  const piece = board.squares.get(from);
  if (!piece || piece.type !== 'k' || !isHomeSquare(piece.color, 'k', from)) return false;
  return Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2;
}

/**
 * Does this UCI move DEVELOP, in the classical sense? True when it castles, or
 * when it moves a knight/bishop OFF its home square for the first time.
 */
export function isDevelopingUci(board: Board, uci: string): boolean {
  if (isCastlingUci(board, uci)) return true;
  const { from, to } = parseUciMove(uci);
  const piece = board.squares.get(from);
  if (!piece) return false;
  if (piece.type !== 'n' && piece.type !== 'b') return false;
  return isHomeSquare(piece.color, piece.type, from) && !isHomeSquare(piece.color, piece.type, to);
}

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

export function pieceName(type: PieceType): string {
  return PIECE_NAMES[type];
}

/** "knight on g1" — human wording for explanation text. */
export function describePiece(board: Board, square: string): string {
  const piece = board.squares.get(square);
  return piece ? `${pieceName(piece.type)} on ${square}` : `piece on ${square}`;
}

/* ────────────────────────── attack geometry ──────────────────────────
 * Enough attack/defence arithmetic for principle detectors. Pins, x-rays and
 * capture ORDER are deliberately out of scope (that level of precision belongs
 * to the engine upstream) — every consumer must treat these as good first-order
 * approximations, which is exactly the beginner's counting rule they model.
 */

/** Conventional material values. The king is priced arbitrarily high. */
export const PIECE_VALUES: Record<PieceType, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 100,
};

export function otherColor(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_OFFSETS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function sq(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return FILES.charAt(file) + String(rank);
}

/**
 * Every square the piece on `from` attacks (or, equally, defends): pawn
 * diagonals, knight/king offsets, sliders stopping at the first occupied
 * square (which is included — that's the attacked/defended piece).
 */
export function attacks(board: Board, from: string): string[] {
  const piece = board.squares.get(from);
  if (!piece) return [];
  const file = from.charCodeAt(0) - 97;
  const rank = Number(from.charAt(1));
  const out: string[] = [];

  if (piece.type === 'p') {
    const dir = piece.color === 'white' ? 1 : -1;
    for (const df of [-1, 1]) {
      const s = sq(file + df, rank + dir);
      if (s) out.push(s);
    }
    return out;
  }
  if (piece.type === 'n' || piece.type === 'k') {
    const offsets = piece.type === 'n' ? KNIGHT_OFFSETS : KING_OFFSETS;
    for (const [df, dr] of offsets) {
      const s = sq(file + df, rank + dr);
      if (s) out.push(s);
    }
    return out;
  }
  const dirs =
    piece.type === 'r' ? ROOK_DIRS
    : piece.type === 'b' ? BISHOP_DIRS
    : [...ROOK_DIRS, ...BISHOP_DIRS];
  for (const [df, dr] of dirs) {
    for (let step = 1; ; step++) {
      const s = sq(file + df * step, rank + dr * step);
      if (!s) break;
      out.push(s);
      if (board.squares.has(s)) break; // sliders stop at (and include) the first blocker
    }
  }
  return out;
}

/** Squares of `byColor` pieces that attack/defend `square`. */
export function attackersOf(board: Board, square: string, byColor: Color): string[] {
  const out: string[] = [];
  for (const [from, piece] of board.squares) {
    if (piece.color !== byColor || from === square) continue;
    if (attacks(board, from).includes(square)) out.push(from);
  }
  return out.sort();
}

/** Why a piece counts as hanging. */
export type HangReason = 'undefended' | 'cheaper-attacker' | 'outnumbered';

export interface HangingInfo {
  readonly square: string;
  readonly piece: Piece;
  readonly value: number;
  readonly attackers: readonly string[];
  readonly defenders: readonly string[];
  readonly reason: HangReason;
}

/**
 * The colour's pieces that can currently be won by the enemy, with the
 * beginner-rule reason:
 *  - `undefended`      — attacked and nobody guards it: free to take;
 *  - `cheaper-attacker`— a cheaper piece attacks it: recapturing still loses material;
 *  - `outnumbered`     — more attackers than defenders (first capture not a
 *                        sacrifice): the exchange sequence wins material.
 *
 * Kings are skipped (attacked king = check, a different topic). An enemy KING
 * is not counted as an attacker of a defended piece (it could never legally
 * complete that capture). Sorted most-valuable first.
 */
export function hangingPieces(board: Board, color: Color): HangingInfo[] {
  const enemy = otherColor(color);
  const out: HangingInfo[] = [];
  for (const [square, piece] of board.squares) {
    if (piece.color !== color || piece.type === 'k') continue;
    const rawAttackers = attackersOf(board, square, enemy);
    if (rawAttackers.length === 0) continue;
    const defenders = attackersOf(board, square, color);
    const attackers = defenders.length
      ? rawAttackers.filter((a) => board.squares.get(a)?.type !== 'k')
      : rawAttackers;
    if (attackers.length === 0) continue;

    const value = PIECE_VALUES[piece.type];
    const cheapest = Math.min(
      ...attackers.map((a) => PIECE_VALUES[(board.squares.get(a) as Piece).type]),
    );

    let reason: HangReason | null = null;
    if (defenders.length === 0) reason = 'undefended';
    else if (cheapest < value) reason = 'cheaper-attacker';
    else if (attackers.length > defenders.length && cheapest <= value) reason = 'outnumbered';

    if (reason) out.push({ square, piece, value, attackers, defenders, reason });
  }
  return out.sort((a, b) => b.value - a.value);
}
