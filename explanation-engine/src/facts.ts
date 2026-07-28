/**
 * What actually happened on the board.
 *
 * Pure observation, no opinion and no prose: the writing engine ({@link ./coach})
 * quotes these facts so its sentences are about THIS position rather than
 * generic advice. Everything here is read from the two board snapshots, so a
 * sentence built on it can never describe a move that was not played.
 */

import {
  attackersOf,
  attacksFrom,
  hangingPieces,
  isCastlingUci,
  isHomeSquare,
  isInCheck,
  otherColor,
  parseUciMove,
  PIECE_VALUES,
  PieceType,
} from './board';
import { pieceMobility } from './positional';
import { boardsOf } from './context';
import { Color, MoveContext } from './types';

/** The four squares in the middle of the board. */
const MIDDLE: ReadonlySet<string> = new Set(['d4', 'e4', 'd5', 'e5']);

/** A piece sitting on a square. */
export interface Spot { readonly square: string; readonly type: PieceType }

export interface MoveFacts {
  readonly piece: PieceType;
  readonly from: string;
  readonly to: string;
  /** What the move captured, if anything. */
  readonly captured: PieceType | null;
  readonly castled: boolean;
  readonly promoted: PieceType | null;
  readonly check: boolean;
  readonly mate: boolean;
  /** Enemy pieces the moved piece now attacks, most valuable first. */
  readonly nowAttacks: readonly Spot[];
  /** Own pieces the move now defends that were under attack. */
  readonly guards: readonly Spot[];
  /** Empty squares the move takes away from the enemy. */
  readonly denies: readonly string[];
  /** One of ours left free to be taken after the move. */
  readonly leftHanging: Spot | null;
  /** Cheapest enemy piece that can grab it, for a red arrow. */
  readonly hangingAttacker: string | null;
  /** The piece left its starting square for the first time. */
  readonly cameOut: boolean;
  readonly landedInMiddle: boolean;
  /** How many squares the moved piece has from its new home. */
  readonly mobilityAfter: number;
}

/** Read the position and work out what the played move did. */
export function readMove(ctx: MoveContext): MoveFacts | null {
  const boards = boardsOf(ctx);
  if (!boards) return null;
  const { before, after } = boards;
  let from: string, to: string, promotion: string | undefined;
  try {
    ({ from, to, promotion } = parseUciMove(ctx.uci));
  } catch {
    return null;
  }
  const moved = before.squares.get(from);
  if (!moved) return null;

  const me: Color = ctx.mover;
  const enemy = otherColor(me);
  const target = before.squares.get(to);
  const captured = target && target.color === enemy ? target.type : null;

  let castled = false;
  try { castled = isCastlingUci(before, ctx.uci); } catch { castled = false; }

  const check = isInCheck(after, enemy);
  // SAN carries the verdict ("Qxf7#") exactly, with no move generation needed.
  const mate = check && ctx.san.includes('#');

  const nowAttacks: Spot[] = [];
  const guards: Spot[] = [];
  const denies: string[] = [];
  for (const sq of attacksFrom(after.squares, to)) {
    const p = after.squares.get(sq);
    if (!p) {
      if (attackersOf(after, sq, enemy).length > 0) denies.push(sq);
      continue;
    }
    if (p.color === enemy) { if (p.type !== 'k') nowAttacks.push({ square: sq, type: p.type }); }
    // Defending a piece nobody attacks is not worth a sentence.
    else if (p.type !== 'k' && attackersOf(after, sq, enemy).length > 0) {
      guards.push({ square: sq, type: p.type });
    }
  }
  nowAttacks.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);
  guards.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);

  const free = hangingPieces(after, me)
    .filter((h) => h.reason === 'undefended' || h.reason === 'cheaper-attacker')
    .sort((a, b) => b.value - a.value)[0];
  const cheapest = free
    ? [...free.attackers].sort(
        (a, b) => PIECE_VALUES[after.squares.get(a)?.type ?? 'p'] - PIECE_VALUES[after.squares.get(b)?.type ?? 'p'],
      )[0] ?? null
    : null;

  return {
    piece: moved.type,
    from, to,
    captured,
    castled,
    promoted: promotion ? (promotion.toLowerCase() as PieceType) : null,
    check,
    mate,
    nowAttacks,
    guards,
    denies,
    leftHanging: free ? { square: free.square, type: free.piece.type } : null,
    hangingAttacker: cheapest,
    cameOut: moved.type !== 'p' && isHomeSquare(me, moved.type, from),
    landedInMiddle: moved.type === 'p' && MIDDLE.has(to),
    mobilityAfter: pieceMobility(after, to),
  };
}
