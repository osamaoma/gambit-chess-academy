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
