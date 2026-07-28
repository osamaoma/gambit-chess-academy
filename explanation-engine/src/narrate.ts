/**
 * The storyteller — one playful, dead-simple sentence for EVERY move.
 *
 * Detectors are experts: they find outposts, pawn levers and back-rank mates,
 * and they say so in club-player language. That is the wrong voice for a card
 * a small child should understand, and — worse — a detector may describe the
 * ENGINE's move rather than the one actually played, which reads as a plain
 * falsehood ("you played c5" + "there was a bishop pin").
 *
 * This module fixes both problems by construction:
 *
 *  1. EVERY sentence is derived from what the PLAYED move did on the board —
 *     what moved, what it ate, what it now points at, whether the king is
 *     safe. It can never claim a tactic that did not happen.
 *  2. The vocabulary is deliberately tiny and the tone is silly: a knight is a
 *     "horse", pieces "gobble", "hide" and "shout". Anyone can follow it.
 *
 * Every move gets a line — quiet ones included — so stepping through a game
 * always tells you something, and never just "the computer liked this move".
 */

import {
  attacksFrom,
  Board,
  hangingPieces,
  isCastlingUci,
  isHomeSquare,
  isInCheck,
  otherColor,
  parseUciMove,
  PIECE_VALUES,
  PieceType,
} from './board';
import { boardsOf } from './context';
import { ArrowHint, SquareHint, Visuals } from './detector';
import { Color, MoveContext } from './types';

/** Playground names — a knight is a horse, and everything is friendly. */
const KID_NAME: Readonly<Record<PieceType, string>> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'horse', p: 'pawn',
};

/** The four squares in the middle of the board. */
const MIDDLE: ReadonlySet<string> = new Set(['d4', 'e4', 'd5', 'e5']);

/** What the storyteller works out about one played move. */
interface MoveFacts {
  readonly piece: PieceType;
  readonly from: string;
  readonly to: string;
  readonly eaten: PieceType | null;
  readonly castled: boolean;
  readonly promoted: PieceType | null;
  readonly check: boolean;
  readonly mate: boolean;
  /** Enemy pieces the moved piece now points at, biggest first. */
  readonly nowAttacks: readonly { square: string; type: PieceType }[];
  /** A piece of ours left free to be taken after the move (biggest first). */
  readonly leftHanging: { square: string; type: PieceType } | null;
  /** The moved piece stepped off its starting square for the first time. */
  readonly cameOut: boolean;
  readonly landedInMiddle: boolean;
}

/** Pick one of several lines, but always the same one for the same move. */
function pick(options: readonly string[], seed: number): string {
  return options[Math.abs(seed) % options.length] as string;
}

/** Read the position and work out what actually happened. */
function readMove(ctx: MoveContext): MoveFacts | null {
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
  const eaten = target && target.color === enemy ? target.type : null;

  let castled = false;
  try { castled = isCastlingUci(before, ctx.uci); } catch { castled = false; }

  const check = isInCheck(after, enemy);
  // SAN already carries the verdict ("Qxf7#"), which is exact and needs no
  // move generation — a check that is also mate ends the game there and then.
  const mate = check && ctx.san.includes('#');

  // What does the piece point at from its new home?
  const nowAttacks: { square: string; type: PieceType }[] = [];
  for (const sq of attacksFrom(after.squares, to)) {
    const p = after.squares.get(sq);
    if (p && p.color === enemy && p.type !== 'k') nowAttacks.push({ square: sq, type: p.type });
  }
  nowAttacks.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);

  // Did we leave something of ours free to be grabbed?
  const free = hangingPieces(after, me)
    .filter((h) => h.reason === 'undefended' || h.reason === 'cheaper-attacker')
    .sort((a, b) => b.value - a.value)[0];

  return {
    piece: moved.type,
    from, to,
    eaten,
    castled,
    promoted: promotion ? (promotion.toLowerCase() as PieceType) : null,
    check,
    mate,
    nowAttacks,
    leftHanging: free ? { square: free.square, type: free.piece.type } : null,
    cameOut: moved.type !== 'p' && isHomeSquare(me, moved.type, from),
    landedInMiddle: moved.type === 'p' && MIDDLE.has(to),
  };
}

/** Where the king ended up, so we can point at it when it hides away. */
function kingHome(board: Board, color: Color): string | null {
  for (const [sq, p] of board.squares) if (p.color === color && p.type === 'k') return sq;
  return null;
}

export interface Narration {
  readonly summary: string;
  readonly visuals: Visuals;
}

/**
 * Tell the story of one move in a single silly sentence, plus the arrows and
 * squares that show it. Returns null only when the position cannot be read.
 */
export function narrate(ctx: MoveContext): Narration | null {
  const f = readMove(ctx);
  if (!f) return null;

  const name = KID_NAME[f.piece];
  const seed = ctx.ply * 7 + f.to.charCodeAt(0);
  const arrows: ArrowHint[] = [];
  const squares: SquareHint[] = [];
  const moveArrow = (color: ArrowHint['color'] = 'idea') => arrows.push({ from: f.from, to: f.to, color });

  // ── 1. Checkmate — the loudest thing that can happen ──
  if (f.mate) {
    moveArrow();
    const k = kingHome(boardsOf(ctx)!.after, otherColor(ctx.mover));
    if (k) squares.push({ square: k, color: 'danger' });
    return {
      summary: pick([
        `Checkmate! The ${name} lands on ${f.to} and the king has nowhere left to run. Game over!`,
        `That's mate! The ${name} sneaks to ${f.to} and the king is trapped. All done!`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 2. Leaving a big piece to be snatched — the thing to learn from ──
  if (f.leftHanging && PIECE_VALUES[f.leftHanging.type] >= 3) {
    moveArrow('danger');
    squares.push({ square: f.leftHanging.square, color: 'danger' });
    const lost = KID_NAME[f.leftHanging.type];
    return {
      summary: pick([
        `Uh oh — the ${lost} on ${f.leftHanging.square} is standing all alone and can be snatched.`,
        `Careful! Nobody is guarding the ${lost} on ${f.leftHanging.square}, so it can be taken for free.`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 3. Check ──
  if (f.check) {
    moveArrow();
    const k = kingHome(boardsOf(ctx)!.after, otherColor(ctx.mover));
    if (k) squares.push({ square: k, color: 'danger' });
    return {
      summary: pick([
        `Check! The ${name} shouts at the king from ${f.to}. He has to deal with it right now.`,
        `Check! The ${name} jumps to ${f.to} and points straight at the king. Move him, quick!`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 4. A pawn walks all the way and grows up ──
  if (f.promoted) {
    moveArrow();
    squares.push({ square: f.to, color: 'idea' });
    return {
      summary: `The little pawn marched all the way to ${f.to} and turned into a ${KID_NAME[f.promoted]}. Magic!`,
      visuals: { arrows, squares },
    };
  }

  // ── 5. Castling — the king hides ──
  if (f.castled) {
    moveArrow();
    squares.push({ square: f.to, color: 'idea' });
    return {
      summary: pick([
        `The king dives into his castle and slams the door. Safe and cosy!`,
        `The king scoots off to a safe corner, and the rook hops out to help. Teamwork!`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 6. Eating something ──
  if (f.eaten) {
    moveArrow();
    squares.push({ square: f.to, color: 'target' });
    const food = KID_NAME[f.eaten];
    return {
      summary: pick([
        `The ${name} gobbles up the ${food} on ${f.to}. Yum!`,
        `Chomp! The ${name} takes the ${food} on ${f.to}.`,
        `The ${name} snatches the ${food} sitting on ${f.to}.`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 7. Now pointing at something big ──
  const juicy = f.nowAttacks[0];
  if (juicy && PIECE_VALUES[juicy.type] >= 3) {
    moveArrow();
    arrows.push({ from: f.to, to: juicy.square, color: 'target' });
    squares.push({ square: juicy.square, color: 'danger' });
    return {
      summary: pick([
        `The ${name} moves to ${f.to} and stares right at the ${KID_NAME[juicy.type]} on ${juicy.square}. Watch out!`,
        `Sneaky! From ${f.to} the ${name} is now aiming at the ${KID_NAME[juicy.type]} on ${juicy.square}.`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 8. A pawn plants itself in the middle ──
  if (f.landedInMiddle) {
    moveArrow();
    squares.push({ square: f.to, color: 'idea' });
    return {
      summary: pick([
        `A brave little pawn plants itself right in the middle on ${f.to}. That's the best spot!`,
        `The little pawn stomps into the middle on ${f.to} and takes up space.`,
      ], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 9. Coming out to play for the first time ──
  if (f.cameOut) {
    moveArrow();
    squares.push({ square: f.to, color: 'idea' });
    const flavour: Partial<Record<PieceType, string[]>> = {
      n: [`The horse jumps out to ${f.to} to guard the middle. Clip-clop!`,
          `The horse hops off the back row to ${f.to}, ready to help.`],
      b: [`The bishop slides out to ${f.to} and looks down a long, empty road.`,
          `The bishop comes out to ${f.to} so it can see across the board.`],
      r: [`The rook rolls out to ${f.to} to watch a whole line at once.`],
      q: [`The queen steps out to ${f.to} — the strongest piece joins in.`],
      k: [`The king shuffles over to ${f.to}.`],
    };
    return {
      summary: pick(flavour[f.piece] ?? [`The ${name} comes out to ${f.to} to join the fun.`], seed),
      visuals: { arrows, squares },
    };
  }

  // ── 10. A quiet move still gets a story ──
  moveArrow();
  squares.push({ square: f.to, color: 'idea' });
  const quiet = f.piece === 'p'
    ? [`The little pawn takes one small step to ${f.to}, making room for its friends.`,
       `A tiny pawn step to ${f.to} — small moves matter too!`]
    : [`The ${name} slides over to ${f.to} to get a better view.`,
       `The ${name} tiptoes to ${f.to} and waits for its moment.`,
       `The ${name} moves to ${f.to} to help out from a better spot.`];
  return { summary: pick(quiet, seed), visuals: { arrows, squares } };
}
