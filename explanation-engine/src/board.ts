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

/** The square of the colour's king, or null (should never be null in a legal game). */
export function kingSquareOf(board: Board, color: Color): string | null {
  for (const [square, piece] of board.squares) {
    if (piece.color === color && piece.type === 'k') return square;
  }
  return null;
}

/** The king's square plus its on-board neighbours (the 3×3 "king zone"). */
export function kingZone(square: string): string[] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.charAt(1));
  const out = [square];
  for (const [df, dr] of KING_OFFSETS) {
    const s = sq(file + df, rank + dr);
    if (s) out.push(s);
  }
  return out;
}

/** Is `color`'s king currently attacked? (No move generation — just geometry.) */
export function isInCheck(board: Board, color: Color): boolean {
  const ks = kingSquareOf(board, color);
  return !!ks && attackersOfSquares(board.squares, ks, otherColor(color)).length > 0;
}

/**
 * Apply an (assumed-legal) UCI move and return the resulting board. Handles
 * captures, promotion, castling (the rook hop) and en passant. Castling rights
 * are not tracked precisely — detectors that follow an engine line only need
 * accurate piece placement, not rights.
 */
export function applyUciMove(board: Board, uci: string): Board {
  const { from, to, promotion } = parseUciMove(uci);
  const piece = board.squares.get(from);
  if (!piece) return board;
  const squares = new Map(board.squares);
  squares.delete(from);

  // en passant: a pawn moving diagonally onto an empty square captures behind it
  if (piece.type === 'p' && from.charAt(0) !== to.charAt(0) && !board.squares.get(to)) {
    squares.delete(to.charAt(0) + from.charAt(1));
  }
  squares.set(to, promotion ? { color: piece.color, type: promotion } : piece);

  // castling: the king moved two files, so hop the rook to its side
  if (piece.type === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
    const rank = from.charAt(1);
    if (to.charAt(0) === 'g') {
      squares.delete('h' + rank);
      squares.set('f' + rank, { color: piece.color, type: 'r' });
    } else if (to.charAt(0) === 'c') {
      squares.delete('a' + rank);
      squares.set('d' + rank, { color: piece.color, type: 'r' });
    }
  }
  return { squares, sideToMove: otherColor(board.sideToMove), castling: board.castling };
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
/** A bare occupancy map — the input SEE mutates as pieces come off the board. */
export type Squares = ReadonlyMap<string, Piece>;

/**
 * Every square controlled by the piece on `from`, computed against a raw
 * occupancy map. Slider rays stop at (and include) the first occupied square,
 * so removing a blocker from the map naturally reveals x-ray attackers — which
 * is exactly what SEE needs between captures.
 */
export function attacksFrom(squares: Squares, from: string): string[] {
  const piece = squares.get(from);
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
      if (squares.has(s)) break; // sliders stop at (and include) the first blocker
    }
  }
  return out;
}

/** Squares controlled by the piece on `from`. */
export function attacks(board: Board, from: string): string[] {
  return attacksFrom(board.squares, from);
}

/** Squares of `byColor` pieces that attack/defend `square`, on a raw map. */
export function attackersOfSquares(squares: Squares, square: string, byColor: Color): string[] {
  const out: string[] = [];
  for (const [from, piece] of squares) {
    if (piece.color !== byColor || from === square) continue;
    if (attacksFrom(squares, from).includes(square)) out.push(from);
  }
  return out.sort();
}

/** Squares of `byColor` pieces that attack/defend `square`. */
export function attackersOf(board: Board, square: string, byColor: Color): string[] {
  return attackersOfSquares(board.squares, square, byColor);
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

/* ────────────────────────── Static Exchange Evaluation ──────────────────────
 * SEE answers "if this move starts a capture battle on the target square, how
 * much material does the mover end up ahead or behind?" — assuming both sides
 * always recapture with their cheapest attacker. It is the correct tool for
 * grading a single move's trade: winning material, an even trade, a favourable
 * or unfavourable exchange, or a (material) sacrifice.
 *
 * This is a standard swap-list SEE. X-ray reveal is handled for free because
 * attackers are recomputed from the shrinking occupancy map each step. Pins are
 * NOT modelled (that precision belongs to the engine upstream); the king may
 * only recapture when the far side has no answer, so it never "captures into
 * check".
 */

/** Cheapest `color` piece that attacks `to` on the given occupancy, or null. */
function leastValuableAttacker(squares: Squares, to: string, color: Color): string | null {
  let best: string | null = null;
  let bestVal = Infinity;
  for (const [from, piece] of squares) {
    if (piece.color !== color || from === to) continue;
    const v = PIECE_VALUES[piece.type];
    if (v < bestVal && attacksFrom(squares, from).includes(to)) {
      bestVal = v;
      best = from;
    }
  }
  return best;
}

/**
 * Net material (in pawns, from the mover's point of view) of playing `from`→`to`
 * and resolving the resulting capture sequence. Positive = the mover comes out
 * ahead. A non-capturing move that walks onto an attacked square returns a
 * negative value (the material the opponent can win).
 */
export function staticExchangeEval(board: Board, from: string, to: string): number {
  const mover = board.squares.get(from);
  if (!mover) return 0;
  const target = board.squares.get(to);
  if (target && target.color === mover.color) return 0; // never captures own piece

  const work = new Map(board.squares);
  const gain: number[] = [target ? PIECE_VALUES[target.type] : 0];
  work.delete(from);
  work.set(to, mover);

  let onSquare = PIECE_VALUES[mover.type]; // value of the piece now standing on `to`
  let side = otherColor(mover.color);
  let d = 0;

  for (let guard = 0; guard < 32; guard++) {
    const attackerSq = leastValuableAttacker(work, to, side);
    if (!attackerSq) break;
    const attacker = work.get(attackerSq) as Piece;
    if (attacker.type === 'k') {
      // The king can only recapture if the far side can no longer answer.
      const probe = new Map(work);
      probe.delete(attackerSq);
      probe.set(to, attacker);
      if (leastValuableAttacker(probe, to, otherColor(side))) break;
    }
    d++;
    gain[d] = onSquare - (gain[d - 1] as number);
    onSquare = PIECE_VALUES[attacker.type];
    work.delete(attackerSq);
    work.set(to, attacker);
    side = otherColor(side);
  }

  // Minimax the swap list back: each side stops capturing once continuing hurts.
  while (d > 0) {
    gain[d - 1] = -Math.max(-(gain[d - 1] as number), gain[d] as number);
    d--;
  }
  return (gain[0] as number) || 0; // normalise -0 → 0
}

/* ────────────────────────── coordinate helpers ──────────────────────────
 * Small, exported conversions so positional code (and future detectors) share
 * one implementation instead of re-deriving file/rank math.
 */

/** 0-based file index of a square ('a'→0 … 'h'→7). */
export function fileIndex(square: string): number {
  return square.charCodeAt(0) - 97;
}

/** 1-based rank of a square ('e4'→4). */
export function rankIndex(square: string): number {
  return Number(square.charAt(1));
}

/** Square name from a 0-based file and 1-based rank, or null if off-board. */
export function squareAt(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return 'abcdefgh'.charAt(file) + String(rank);
}

/** The light/dark colour of a square (a1 is dark). */
export function squareColor(square: string): 'light' | 'dark' {
  return (fileIndex(square) + rankIndex(square)) % 2 === 0 ? 'light' : 'dark';
}

/** Serialise a board back to a FEN (clocks fixed at "- 0 1"). Inverse of parseFen for placement/side/castling. */
export function toFen(board: Board): string {
  let placement = '';
  for (let rank = 8; rank >= 1; rank--) {
    let empty = 0;
    let row = '';
    for (let file = 0; file < 8; file++) {
      const p = board.squares.get(FILES.charAt(file) + String(rank));
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'white' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += empty;
    placement += row + (rank > 1 ? '/' : '');
  }
  return `${placement} ${board.sideToMove === 'white' ? 'w' : 'b'} ${board.castling || '-'} - 0 1`;
}
