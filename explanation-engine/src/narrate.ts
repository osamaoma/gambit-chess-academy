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
 * The detectors' chess IDEAS, said the way you'd say them to a child.
 *
 * This is the important half of the module. A detector already worked out the
 * real point of the move ("occupy-center", "knight-outpost", "back-rank") and
 * which squares show it; all that is missing is the voice. Mapping kind → kid
 * sentence keeps the chess knowledge in the detectors, where it belongs, and
 * keeps the vocabulary here, where it belongs.
 */
const KID_IDEA: Readonly<Record<string, (n: string) => string>> = {
  // ── the middle of the board ──
  'occupy-center': () => `Right into the middle! Standing in the centre means more room for everyone.`,
  'contest-center': () => `A cheeky poke at the big pawns in the middle, to break them up.`,
  'strong-center': () => `The middle of the board belongs to this side now — loads of space to move around.`,
  'loss-of-center': () => `That hands over the middle. The other side gets all the space now.`,
  'missed-break': () => `The middle needed a poke here, and it never came.`,
  // ── pieces getting busy ──
  'developed': (n) => `The ${n} comes out to play. Get everyone off the back row!`,
  'rook-open-file': () => `The rook finds an open road and can zoom all the way up it.`,
  'knight-outpost': () => `The horse lands on a super square where no pawn can ever shoo it away!`,
  'strong-bishop': () => `The bishop gets a long clear path to zoom along.`,
  'connected-rooks': () => `The two rooks can see each other now. They work as a team!`,
  'activated': (n) => `The ${n} hops somewhere much busier and finally has things to do.`,
  'passive-piece': (n) => `The ${n} is stuck in a corner with almost nowhere to go. Poor thing.`,
  'bad-bishop': () => `The bishop is stuck behind its own pawns and can't see out.`,
  'missed-activity': () => `A sleepy piece could have woken up here, but it stayed in bed.`,
  // ── pawns ──
  'passed-pawn': () => `This pawn has a clear run to the end. Nobody can stop it!`,
  'connected-passers': () => `Two pawns run side by side, helping each other to the finish line.`,
  'pawn-majority': () => `More pawns on this side means a good chance to make a brand new queen.`,
  'damaged-enemy-structure': () => `That leaves the other side with wobbly, broken pawns.`,
  'strong-chain': () => `The pawns line up in a chain, each one guarding the next. Very sturdy!`,
  'isolated-pawn': () => `This pawn is all alone with no pawn friends to look after it.`,
  'doubled-pawns': () => `Two pawns stacked on the same line — they get in each other's way.`,
  'backward-pawn': () => `This pawn got left behind and can't catch up with its friends.`,
  'weak-chain': () => `There's a hole in the pawn wall now.`,
  // ── the king ──
  'castling': () => `The king is still out in the open. Time to tuck him away somewhere safe!`,
  'open-file': () => `A door just opened right next to the king. That's scary!`,
  'pawn-shield': () => `The pawns in front of the king wandered off — his blanket is gone.`,
  'king-safety': () => `The king is feeling a bit chilly out there.`,
  // ── endgame ──
  'promotion-threat': () => `This pawn is nearly at the end. A new queen is coming!`,
  'outside-passer': () => `A runner way out on the edge — the enemy king can't catch it.`,
  'opposition': () => `The kings stare each other down. Whoever moves first has to give way!`,
  'rook-activity': () => `The rook gets busy behind the running pawn, right where it belongs.`,
  'king-activity': () => `In the endgame the king turns into a fighter and marches up the board.`,
  'pawn-race': () => `Both sides are racing their pawns to the end. Fastest one wins!`,
  'fortress': () => `A wall the other side simply cannot break through.`,
  'passive-king': () => `The king is hiding when he should be marching up to help.`,
  // ── tactics ──
  'fork': () => `One piece attacks two things at once. Only one of them can run away!`,
  'pin': () => `That piece is stuck! If it moves, something bigger behind it gets taken.`,
  'skewer': () => `The big piece has to move out of the way, and the one behind it gets grabbed.`,
  'discovered-check': () => `Sneaky! Moving one piece uncovered another one shouting at the king.`,
  'discovered-attack': () => `Moving one piece uncovered a second one aiming at something juicy.`,
  'double-attack': () => `Two things are attacked at the same time. You can't save both!`,
  'back-rank': () => `The king is trapped behind his own pawns on the back row. No escape!`,
  'mating-net': () => `The net is closing around the king — mate is coming.`,
  'overloaded': () => `That defender is doing two jobs at once, and it can't manage both.`,
  'deflection': () => `The guard gets dragged away from the thing it was protecting.`,
  'decoy': () => `A tasty offer lures a piece onto exactly the wrong square.`,
  'x-ray': () => `One piece sees straight through another, all the way to the prize.`,
  // ── material ──
  'sacrifice': () => `A piece given away on purpose! There's a bigger prize coming.`,
  'lose-material': () => `That gives away pieces for nothing in return.`,
  'unfavorable-exchange': () => `That swap comes out badly — the other side gets the better deal.`,
  'win-material': () => `Free stuff! That wins material for nothing.`,
};

/**
 * Which idea to lead with when several apply.
 *
 * The engine ranks by how RELIABLE a claim is; a child needs ranking by how
 * much the idea explains the move. A developing move that happens to line a
 * bishop up with a knight is a developing move — announcing "that piece is
 * stuck in a pin!" is technically defensible and completely misleading. So:
 * loud, decisive tactics first, then plain positional ideas, and only then the
 * subtle tactics that are usually a side effect rather than the point.
 */
const IDEA_ORDER: readonly string[] = [
  // things that decide the game right now
  'back-rank', 'mating-net', 'fork', 'skewer', 'double-attack', 'discovered-check',
  'sacrifice', 'win-material', 'lose-material', 'unfavorable-exchange',
  // the actual point of most moves
  'developed', 'occupy-center', 'knight-outpost', 'rook-open-file', 'strong-bishop',
  'connected-rooks', 'activated', 'contest-center', 'strong-center',
  'promotion-threat', 'outside-passer', 'passed-pawn', 'connected-passers',
  'pawn-majority', 'strong-chain', 'king-activity', 'rook-activity', 'opposition',
  'pawn-race', 'fortress', 'damaged-enemy-structure',
  // problems worth naming
  'passive-piece', 'bad-bishop', 'loss-of-center', 'missed-break', 'missed-activity',
  'isolated-pawn', 'doubled-pawns', 'backward-pawn', 'weak-chain', 'passive-king',
  // real, but usually a side effect rather than the reason for the move
  'pin', 'x-ray', 'overloaded', 'deflection', 'decoy', 'discovered-attack',
  // Last: these describe the KING's situation, not the move. Otherwise every
  // quiet pawn push gets "your king is still in the open!", which is true of
  // the position but says nothing about the move that was actually played.
  'open-file', 'pawn-shield', 'castling', 'king-safety',
];

/** Find the detector's idea among the explanation's tags, best-explaining first. */
function ideaFromTags(tags: readonly string[] | undefined, name: string): string | null {
  if (!tags || tags.length === 0) return null;
  const present = new Set(tags);
  for (const kind of IDEA_ORDER) {
    if (present.has(kind)) return (KID_IDEA[kind] as (n: string) => string)(name);
  }
  return null;
}

/**
 * Tell the story of one move in a single silly sentence, plus the arrows and
 * squares that show it. Returns null only when the position cannot be read.
 */
export function narrate(
  ctx: MoveContext,
  expert?: { readonly tags?: readonly string[]; readonly visuals?: Visuals },
): Narration | null {
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

  // ── 7. THE DETECTOR'S IDEA — the real point of the move ──
  // Everything above is a concrete event a beginner must be told about first
  // (mate, a piece hanging, check, a capture). Past that, the detectors know
  // far more about WHY a move is good than any rule of thumb here does, so we
  // say their idea in kid words and reuse the squares they already worked out.
  const idea = ideaFromTags(expert?.tags, name);
  if (idea) {
    const v = expert?.visuals;
    if (v && (v.arrows.length > 0 || v.squares.length > 0)) {
      // Detectors still draw an arrow along the move itself; the board already
      // highlights that, so strip it and keep only the arrows that add meaning.
      const kept = v.arrows.filter((a) => !(a.from === f.from && a.to === f.to));
      return { summary: idea, visuals: { arrows: kept, squares: v.squares } };
    }
    squares.push({ square: f.to, color: 'idea' });
    return say(idea);
  }

  // ── 8. Now pointing at something big — a threat, in red ──
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

  // (There used to be an "opens a long road for the bishop — it can see all the
  // way to h6!" line here. It described geometry, not an idea, so it is gone.)

  // ── 10. A pawn plants itself in the middle ──
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

  // ── Taking a square away. Ranked LAST of the real ideas: it is true but it
  //    is rarely the POINT of a move, and it used to shout over better ones. ──
  if (f.denies.length > 0) {
    const spot = f.denies[0] as string;
    for (const s of f.denies.slice(0, 2)) squares.push({ square: s, color: 'idea' });
    return say(`The ${name} puts up a "no entry" sign on ${spot}. No enemy piece can sit there now.`);
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
