/**
 * EndgameDetector — technique for the phase where the rules change.
 *
 * It first checks that the position IS an endgame (queens off, or very little
 * non-pawn material) and then reads the move through endgame principles:
 *  - praise (on strong moves): `promotion`, a `promotion-threat` (a passer one
 *    step from queening), an `outside-passer` (a passed pawn far from the enemy
 *    king — the great decoy), `rook-activity` (the seventh rank / behind a
 *    passer), `opposition` (in a king-and-pawn ending), `king-activity`
 *    (centralising the king), a `pawn-race`, or a `fortress` (a drawing setup
 *    while down material);
 *  - criticism (on flawed moves): a `passive-king` (retreating the king from
 *    the action when it should be marching in).
 *
 * Tier `heuristic`: the facts are exact, but "good/bad BECAUSE of endgame
 * technique" is a judgement a concrete tactic or material swing overrules.
 * Praise vs criticism is gated by the classifier so it never fights the verdict.
 */

import {
  Board,
  fileIndex,
  kingSquareOf,
  otherColor,
  parseUciMove,
  PIECE_VALUES,
  rankIndex,
  squareAt,
} from '../board';
import { isPassedPawn, pawnSquares } from '../positional';
import { CRITIQUE_CLASSES, POSITIONAL_CLASSES, PRAISE_CLASSES } from '../classifications';
import { boardsOf } from '../context';
import { ArrowHint, Explanation, Improvement, SignalDetector, SquareHint, Visuals } from '../detector';
import { movers, opponents } from '../perspective';
import { Color, MoveClassification, MoveContext } from '../types';

type EndgameKind =
  | 'promotion'
  | 'promotion-threat'
  | 'outside-passer'
  | 'opposition'
  | 'rook-activity'
  | 'king-activity'
  | 'pawn-race'
  | 'fortress'
  | 'passive-king';

const PRAISE_KINDS: ReadonlySet<EndgameKind> = new Set<EndgameKind>([
  'promotion', 'promotion-threat', 'outside-passer', 'opposition', 'rook-activity', 'king-activity', 'pawn-race', 'fortress',
]);
/** Total value of a colour's pieces excluding the king. */
function material(board: Board, color: Color): number {
  let m = 0;
  for (const [, p] of board.squares) if (p.color === color && p.type !== 'k') m += PIECE_VALUES[p.type];
  return m;
}

/** Endgame phase: queens off the board, or ≤6 non-pawn pieces in total. */
export function isEndgame(board: Board): boolean {
  let nonPawn = 0;
  let queens = 0;
  for (const [, p] of board.squares) {
    if (p.type === 'k' || p.type === 'p') continue;
    nonPawn++;
    if (p.type === 'q') queens++;
  }
  return queens === 0 || nonPawn <= 6;
}

/** Only kings and pawns remain (where opposition is the governing idea). */
function isPawnEnding(board: Board): boolean {
  for (const [, p] of board.squares) if (p.type !== 'k' && p.type !== 'p') return false;
  return true;
}

/** Chebyshev distance from a square to the central 2×2 (d4/d5/e4/e5). 0 = central. */
function centerDistance(square: string): number {
  const f = fileIndex(square);
  const r = rankIndex(square);
  const df = f < 3 ? 3 - f : f > 4 ? f - 4 : 0;
  const dr = r < 4 ? 4 - r : r > 5 ? r - 5 : 0;
  return Math.max(df, dr);
}

/** Ranks a pawn of `color` still needs to reach promotion. */
function ranksToPromote(color: Color, square: string): number {
  return color === 'white' ? 8 - rankIndex(square) : rankIndex(square) - 1;
}

/** Do the two kings stand in DIRECT opposition (aligned, one empty square apart)? */
export function haveDirectOpposition(board: Board, me: Color): boolean {
  const k1 = kingSquareOf(board, me);
  const k2 = kingSquareOf(board, otherColor(me));
  if (!k1 || !k2) return false;
  const f1 = fileIndex(k1), r1 = rankIndex(k1), f2 = fileIndex(k2), r2 = rankIndex(k2);
  if (f1 === f2 && Math.abs(r1 - r2) === 2) {
    const mid = squareAt(f1, (r1 + r2) / 2);
    return !!mid && !board.squares.get(mid);
  }
  if (r1 === r2 && Math.abs(f1 - f2) === 2) {
    const mid = squareAt((f1 + f2) / 2, r1);
    return !!mid && !board.squares.get(mid);
  }
  return false;
}

export interface EndgameSignals {
  readonly kind: EndgameKind | null;
  readonly subject: string;
  readonly bestUci: string;
}

const NO_SIGNAL = (bestUci: string): EndgameSignals => ({ kind: null, subject: '', bestUci });

/** Pure signal computation — exported for reuse and direct testing. */
export function computeEndgameSignals(ctx: MoveContext): EndgameSignals {
  const bestUci = ctx.evalBefore.uci;
  const boards = boardsOf(ctx);
  if (!boards) return NO_SIGNAL(bestUci);
  const { before, after } = boards;
  let from: string;
  let to: string;
  let promotion: string | undefined;
  try {
    ({ from, to, promotion } = parseUciMove(ctx.uci));
  } catch {
    return NO_SIGNAL(bestUci);
  }
  if (!isEndgame(before)) return NO_SIGNAL(bestUci); // phase gate

  const me = ctx.mover;
  const them = otherColor(me);
  const moved = after.squares.get(to);
  const movedType = moved?.type;

  // passed pawns, keyed by FILE so merely advancing an existing passer isn't "new"
  const filesPassedBefore = new Set(
    pawnSquares(before, me).filter((s) => isPassedPawn(before, s, me)).map(fileIndex),
  );
  const passedAfter = pawnSquares(after, me).filter((s) => isPassedPawn(after, s, me));
  const newPassers = passedAfter.filter((s) => !filesPassedBefore.has(fileIndex(s)));
  const enemyKing = kingSquareOf(after, them);

  if (PRAISE_CLASSES.has(ctx.classification)) {
    if (promotion) return { kind: 'promotion', subject: to, bestUci };

    if (movedType === 'p' && ranksToPromote(me, to) === 1 && isPassedPawn(after, to, me)) {
      return { kind: 'promotion-threat', subject: to, bestUci };
    }

    if (enemyKing) {
      const outside = newPassers.find((s) => Math.abs(fileIndex(s) - fileIndex(enemyKing)) >= 3);
      if (outside) return { kind: 'outside-passer', subject: outside, bestUci };
    }

    if (movedType === 'k' && isPawnEnding(after) && haveDirectOpposition(after, me)) {
      return { kind: 'opposition', subject: '', bestUci };
    }

    if (movedType === 'r') {
      const seventh = me === 'white' ? rankIndex(to) === 7 : rankIndex(to) === 2;
      const behindPasser = passedAfter.some(
        (ps) => fileIndex(ps) === fileIndex(to) && (me === 'white' ? rankIndex(to) < rankIndex(ps) : rankIndex(to) > rankIndex(ps)),
      );
      if (seventh) return { kind: 'rook-activity', subject: 'seventh', bestUci };
      if (behindPasser) return { kind: 'rook-activity', subject: 'behind', bestUci };
    }

    if (movedType === 'k' && centerDistance(to) < centerDistance(from)) {
      return { kind: 'king-activity', subject: to, bestUci };
    }

    if (movedType === 'p' && isPassedPawn(after, to, me) && ranksToPromote(me, to) <= 4) {
      const enemyRacer = pawnSquares(after, them).some(
        (s) => isPassedPawn(after, s, them) && ranksToPromote(them, s) <= 4,
      );
      if (enemyRacer) return { kind: 'pawn-race', subject: to, bestUci };
    }

    if (movedType !== 'p' && material(after, them) - material(after, me) >= 2 &&
        ctx.deltas.evalAfter >= -0.8 && ctx.deltas.evalAfter <= 0.6) {
      return { kind: 'fortress', subject: '', bestUci };
    }
    return NO_SIGNAL(bestUci);
  }

  if (CRITIQUE_CLASSES.has(ctx.classification)) {
    if (movedType === 'k' && centerDistance(to) > centerDistance(from)) {
      return { kind: 'passive-king', subject: to, bestUci };
    }
  }

  return NO_SIGNAL(bestUci);
}

export class EndgameDetector extends SignalDetector<EndgameSignals> {
  readonly id = 'endgame';
  readonly tier = 'heuristic' as const;
  override readonly priority = 6;
  override readonly classifications: readonly MoveClassification[] = POSITIONAL_CLASSES;

  protected computeSignals(ctx: MoveContext): EndgameSignals {
    return computeEndgameSignals(ctx);
  }

  /** Point at the square the endgame idea is about (a pawn, a king, a rook post). */
  private visualsFor(s: EndgameSignals): Visuals {
    const arrows: ArrowHint[] = [];
    const squares: SquareHint[] = [];
    const bad = s.kind === 'passive-king';
    if (/^[a-h][1-8]$/.test(s.subject)) {
      squares.push({ square: s.subject, color: bad ? 'danger' : 'idea' });
    }
    if (bad && s.bestUci.length >= 4) {
      arrows.push({ from: s.bestUci.slice(0, 2), to: s.bestUci.slice(2, 4), color: 'best' });
    }
    return { arrows, squares };
  }

  protected appliesTo(ctx: MoveContext): boolean {
    return this.signals(ctx).kind !== null;
  }

  protected confidence(ctx: MoveContext): number {
    switch (this.signals(ctx).kind) {
      case 'promotion': return 0.8;
      case 'promotion-threat': return 0.72;
      case 'opposition': return 0.7;
      case 'outside-passer': return 0.68;
      case 'rook-activity': return 0.62;
      case 'king-activity': return 0.6;
      case 'pawn-race': return 0.6;
      case 'passive-king': return 0.58;
      case 'fortress': return 0.5;
      default: return 0;
    }
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const san = ctx.san;
    const tags = ['endgame', s.kind as string];
    const My = movers(ctx);
    const Their = opponents(ctx);
    const visuals = this.visualsFor(s);

    switch (s.kind) {
      case 'promotion':
        return { headline: `${san} promotes.`, tags, visuals,
          summary: `The pawn reaches ${s.subject} and becomes a queen.`,
          detail: `The pawn reaches ${s.subject} and becomes a new queen — the whole point of an endgame. An extra queen is overwhelming; convert by using it with the king to force mate.` };
      case 'promotion-threat':
        return { headline: `${san} threatens to promote.`, tags, visuals,
          summary: `${My} passed pawn reaches ${s.subject}, one step from queening — they must give up material to stop it.`,
          detail: `The passed pawn reaches ${s.subject}, one step from queening. A pawn on the 7th ties the enemy down — they must give up material or the king's time to stop it. Support the pawn with your king and rook and push it home.` };
      case 'outside-passer':
        return { headline: `${san} creates an outside passed pawn.`, tags, visuals,
          summary: `${My} passed pawn on ${s.subject} is far from ${Their.toLowerCase()} king — it drags the king away from the other wing.`,
          detail: `The passed pawn on ${s.subject} sits far from the enemy king. That is the outside passer's magic: the opponent's king must rush to stop it, and while it is away your king feasts on the pawns on the other wing. Outside passers win king-and-pawn endings.` };
      case 'opposition':
        return { headline: `${san} takes the opposition.`, tags, visuals,
          summary: `${My} king on ${s.subject} takes the opposition — ${Their.toLowerCase()} king must give way.`,
          detail: `The kings stand face to face with one square between them and it is the opponent to move — so they must give way. The opposition is the key to king-and-pawn endings: whoever has it controls the key squares and shoulders the enemy king aside.` };
      case 'rook-activity':
        return s.subject === 'seventh'
          ? { headline: `${san} lifts the rook to the seventh.`, tags, visuals,
              summary: `${My} rook reaches the seventh rank, where it eats pawns and pins the king to the back rank.`,
              detail: `A rook on the 7th rank is a monster in the endgame — it gobbles pawns and pins the enemy king to the back rank. "Rooks belong on the seventh"; an active rook is worth more than a pawn or two of material.` }
          : { headline: `${san} puts the rook behind the passer.`, tags, visuals,
              summary: `${My} rook swings in behind the passed pawn — the Tarrasch rule that wins rook endings.`,
              detail: `Rooks belong BEHIND passed pawns — yours or the opponent's. Behind your own pawn the rook supports every step forward; behind the enemy's it grows more active as the pawn advances. This is the Tarrasch rule, and it wins rook endings.` };
      case 'king-activity':
        return { headline: `${san} activates the king.`, tags, visuals,
          summary: `${My} king marches to ${s.subject} — in the endgame the king is a fighting piece.`,
          detail: `In the endgame the king is a fighting piece — marching it toward the centre (${s.subject}) and the pawns is often the most important move on the board. A centralised king defends, attacks, and escorts pawns; get it into play before anything else.` };
      case 'pawn-race':
        return { headline: `${san} pushes in the pawn race.`, tags, visuals,
          summary: `Both sides are racing to promote — ${san} spends the tempo that decides it.`,
          detail: `Both sides have passed pawns sprinting for promotion — this is a race, and it is decided by a single tempo. Count the moves to queen for each side precisely (and watch for a queen that gives check or stops the other pawn); don't get distracted from the push.` };
      case 'fortress':
        return { headline: `${san} holds the fortress.`, tags, visuals,
          summary: `Down material, but the wall holds — ${Their.toLowerCase()} pieces have no way in.`,
          detail: `You are down material, yet the position is a fortress: the enemy can't break in, so it's a draw despite the deficit. Keep the wall intact — don't be tempted into "active" moves that open a door. A fortress salvages the half point from a lost-looking ending.` };
      case 'passive-king':
        return { headline: `${san} leaves the king passive.`, tags, visuals,
          summary: `${My} king retreats to ${s.subject}, the wrong way — a passive king loses endgames.`,
          detail: `Retreating the king to ${s.subject} sends it the wrong way. In the endgame a passive king is a decisive handicap — while it sits on the edge, the opponent's centralised king dominates. Head for the centre and the pawns, not the corner.` };
      default:
        return { headline: san, detail: '', tags };
    }
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    if (s.kind === 'passive-king' && s.bestUci && s.bestUci.slice(0, 4) !== ctx.uci.slice(0, 4)) {
      tips.push({ moveUci: s.bestUci, advice: 'March the king toward the centre with the engine\'s move instead.' });
    }
    tips.push({
      advice: PRAISE_KINDS.has(s.kind as EndgameKind)
        ? 'Endgame rules of thumb: activate the king, push passed pawns, and put rooks behind them — small edges convert straight into wins.'
        : 'In the endgame, centralise the king and get your rook active before anything else — passive pieces lose won and drawn endings alike.',
    });
    return tips;
  }
}
