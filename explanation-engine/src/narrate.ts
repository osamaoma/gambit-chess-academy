/**
 * The storyteller — one playful, dead-simple sentence for EVERY move, plus the
 * arrows that make it obvious on the board.
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
 *     what it ate, what it now guards, which square it takes away, what it
 *     threatens. It can never claim a tactic that did not happen.
 *  2. The vocabulary is deliberately tiny and the tone is silly: a knight is a
 *     "horse", pieces "gobble", "hide" and "shout".
 *
 * Drawing rules (these matter as much as the words):
 *  - NO from→to arrow. The board already highlights the move that was played,
 *    so an arrow along it is noise. Arrows are reserved for the POINT.
 *  - GREEN = the good idea: what the move guards, the square it takes away,
 *    the road it opens.
 *  - RED = danger: what the move threatens, and what it left hanging.
 *  - A quiet move with nothing to show gets NO arrow at all.
 */

import {
  attackersOf,
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

/** A piece sitting on a square. */
interface Spot { readonly square: string; readonly type: PieceType }

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
  readonly nowAttacks: readonly Spot[];
  /** Our own pieces the move now defends, most valuable first. */
  readonly guards: readonly Spot[];
  /** Empty squares the move takes away from the enemy (they wanted them). */
  readonly denies: readonly string[];
  /** A friendly slider whose road this move cleared, and how far it now sees. */
  readonly opened: { readonly piece: PieceType; readonly from: string; readonly to: string } | null;
  /** One of ours left free to be taken after the move. */
  readonly leftHanging: Spot | null;
  /** Who can grab it (cheapest attacker), for a red arrow. */
  readonly hangingAttacker: string | null;
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

  // Everything the piece touches from its new home.
  const reach = attacksFrom(after.squares, to);

  const nowAttacks: Spot[] = [];
  const guards: Spot[] = [];
  const denies: string[] = [];
  for (const sq of reach) {
    const p = after.squares.get(sq);
    if (!p) {
      // An empty square we now cover. It only matters if the enemy wanted it.
      if (attackersOf(after, sq, enemy).length > 0) denies.push(sq);
      continue;
    }
    if (p.color === enemy) { if (p.type !== 'k') nowAttacks.push({ square: sq, type: p.type }); }
    else if (p.type !== 'k') guards.push({ square: sq, type: p.type });
  }
  nowAttacks.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);
  // Only guards that MATTER: defending a piece nobody is attacking is not the
  // point of a move ("Qh5 guards the h2 pawn" is true but useless). Keeping
  // only pieces actually under fire is what makes "c6 props up d5" land.
  const realGuards = guards
    .filter((g) => attackersOf(after, g.square, enemy).length > 0)
    .sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);

  // Did stepping off `from` clear a road for one of our long-range pieces?
  let opened: MoveFacts['opened'] = null;
  for (const [sq, p] of after.squares) {
    if (p.color !== me || !'rbq'.includes(p.type) || sq === to) continue;
    const wasReach = attacksFrom(before.squares, sq);
    if (!wasReach.includes(from)) continue;            // it wasn't looking this way
    const gained = attacksFrom(after.squares, sq).filter((s) => !wasReach.includes(s));
    if (gained.length >= 2) {
      opened = { piece: p.type, from: sq, to: gained[gained.length - 1] as string };
      break;
    }
  }

  // Did we leave something of ours free to be grabbed?
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
    eaten,
    castled,
    promoted: promotion ? (promotion.toLowerCase() as PieceType) : null,
    check,
    mate,
    nowAttacks,
    guards: realGuards,
    denies,
    opened,
    leftHanging: free ? { square: free.square, type: free.piece.type } : null,
    hangingAttacker: cheapest,
    cameOut: moved.type !== 'p' && isHomeSquare(me, moved.type, from),
    landedInMiddle: moved.type === 'p' && MIDDLE.has(to),
  };
}

/** Where the king ended up, so we can point at it. */
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
  const after = boardsOf(ctx)!.after;
  const enemyKing = kingHome(after, otherColor(ctx.mover));
  const say = (summary: string): Narration => ({ summary, visuals: { arrows, squares } });

  // ── 1. Checkmate — the loudest thing that can happen ──
  if (f.mate) {
    if (enemyKing) {
      arrows.push({ from: f.to, to: enemyKing, color: 'danger' });
      squares.push({ square: enemyKing, color: 'danger' });
    }
    return say(pick([
      `Checkmate! The ${name} lands on ${f.to} and the king has nowhere left to run. Game over!`,
      `That's mate! The ${name} sneaks to ${f.to} and the king is trapped. All done!`,
    ], seed));
  }

  // ── 2. Left a big piece to be snatched — the thing to learn from ──
  if (f.leftHanging && PIECE_VALUES[f.leftHanging.type] >= 3) {
    squares.push({ square: f.leftHanging.square, color: 'danger' });
    if (f.hangingAttacker) arrows.push({ from: f.hangingAttacker, to: f.leftHanging.square, color: 'danger' });
    const lost = KID_NAME[f.leftHanging.type];
    return say(pick([
      `Uh oh — the ${lost} on ${f.leftHanging.square} is standing all alone and can be snatched.`,
      `Careful! Nobody is guarding the ${lost} on ${f.leftHanging.square}, so it can be taken for free.`,
    ], seed));
  }

  // ── 3. Check ──
  if (f.check) {
    if (enemyKing) {
      arrows.push({ from: f.to, to: enemyKing, color: 'danger' });
      squares.push({ square: enemyKing, color: 'danger' });
    }
    return say(pick([
      `Check! The ${name} shouts at the king from ${f.to}. He has to deal with it right now.`,
      `Check! The ${name} points straight at the king from ${f.to}. Move him, quick!`,
    ], seed));
  }

  // ── 4. A pawn walks all the way and grows up ──
  if (f.promoted) {
    squares.push({ square: f.to, color: 'idea' });
    return say(`The little pawn marched all the way to ${f.to} and turned into a ${KID_NAME[f.promoted]}. Magic!`);
  }

  // ── 5. Castling — the king hides ──
  if (f.castled) {
    squares.push({ square: f.to, color: 'idea' });
    return say(pick([
      `The king dives into his castle and slams the door. Safe and cosy!`,
      `The king scoots off to a safe corner, and the rook hops out to help. Teamwork!`,
    ], seed));
  }

  // ── 6. Eating something ──
  if (f.eaten) {
    const food = KID_NAME[f.eaten];
    // If it can be taken straight back, that is the more useful thing to show.
    if (f.leftHanging && f.leftHanging.square === f.to) {
      squares.push({ square: f.to, color: 'danger' });
      if (f.hangingAttacker) arrows.push({ from: f.hangingAttacker, to: f.to, color: 'danger' });
      return say(`The ${name} takes the ${food} on ${f.to} — but watch out, it can be taken straight back!`);
    }
    squares.push({ square: f.to, color: 'idea' });
    return say(pick([
      `The ${name} gobbles up the ${food} on ${f.to}. Yum!`,
      `Chomp! The ${name} takes the ${food} on ${f.to}.`,
    ], seed));
  }

  // ── 7. Now pointing at something big — a threat, in red ──
  const juicy = f.nowAttacks[0];
  if (juicy && PIECE_VALUES[juicy.type] >= 3) {
    arrows.push({ from: f.to, to: juicy.square, color: 'danger' });
    squares.push({ square: juicy.square, color: 'danger' });
    return say(pick([
      `The ${name} moves to ${f.to} and stares right at the ${KID_NAME[juicy.type]} on ${juicy.square}. Watch out!`,
      `Sneaky! From ${f.to} the ${name} is now aiming at the ${KID_NAME[juicy.type]} on ${juicy.square}.`,
    ], seed));
  }

  // ── 8. Propping up a friend under attack — green arrow to what it guards ──
  const friend = f.guards[0];
  if (friend) {
    arrows.push({ from: f.to, to: friend.square, color: 'idea' });
    squares.push({ square: friend.square, color: 'idea' });
    const helped = KID_NAME[friend.type];
    return say(pick([
      `The ${name} on ${f.to} props up the ${helped} on ${friend.square}, which was being picked on.`,
      `The ${name} runs over to guard the ${helped} on ${friend.square}. Phew!`,
    ], seed));
  }

  // ── 9. Taking a square away — green ring on the square nobody may use ──
  if (f.denies.length > 0) {
    const spot = f.denies[0] as string;
    for (const s of f.denies.slice(0, 2)) squares.push({ square: s, color: 'idea' });
    return say(pick([
      `The ${name} on ${f.to} says "no entry!" to ${spot}. Nothing can land there now.`,
      `Sneaky little move — ${spot} is fenced off, so no enemy piece can sit there.`,
    ], seed));
  }

  // ── 10. Opening a road for a big piece ──
  if (f.opened) {
    arrows.push({ from: f.opened.from, to: f.opened.to, color: 'idea' });
    return say(`Moving out of the way opens a long road for the ${KID_NAME[f.opened.piece]} on ${f.opened.from}. Now it can see all the way to ${f.opened.to}!`);
  }

  // ── 11. A pawn plants itself in the middle ──
  if (f.landedInMiddle) {
    squares.push({ square: f.to, color: 'idea' });
    return say(pick([
      `A brave little pawn plants itself right in the middle on ${f.to}. That's the best spot!`,
      `The little pawn stomps into the middle on ${f.to} and takes up space.`,
    ], seed));
  }

  // ── 12. Coming out to play for the first time ──
  if (f.cameOut) {
    squares.push({ square: f.to, color: 'idea' });
    const flavour: Partial<Record<PieceType, string[]>> = {
      n: [`The horse jumps out to ${f.to}, ready to help. Clip-clop!`],
      b: [`The bishop slides out to ${f.to} and looks down a long, empty road.`],
      r: [`The rook rolls out to ${f.to} to watch a whole line at once.`],
      q: [`The queen steps out to ${f.to} — the strongest piece joins in.`],
      k: [`The king shuffles over to ${f.to}.`],
    };
    return say(pick(flavour[f.piece] ?? [`The ${name} comes out to ${f.to} to join the fun.`], seed));
  }

  // ── 13. A slip with nothing concrete to point at. Say so honestly and
  //        vaguely rather than inventing a clever idea that isn't there ──
  if (ctx.classification === 'blunder' || ctx.classification === 'mistake') {
    return say(pick([
      `This one hands the other side a helping hand — there was a better square for the ${name}.`,
      `Hmm, the ${name} on ${f.to} isn't doing much here, and that gives the other side a free go.`,
    ], seed));
  }

  // ── 14. Nothing worth drawing: say something true, draw nothing ──
  return say(f.piece === 'p'
    ? pick([
        `The pawn nudges forward to ${f.to}, making a little room.`,
        `A quiet pawn step to ${f.to} — nothing scary, just tidying up.`,
      ], seed)
    : pick([
        `The ${name} shuffles over to ${f.to} and waits for a better moment.`,
        `The ${name} repositions to ${f.to}, biding its time.`,
      ], seed));
}
