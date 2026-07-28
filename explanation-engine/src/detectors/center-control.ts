/**
 * CenterControlDetector — the classical "fight for the centre" voice.
 *
 * The centre (d4/e4/d5/e5) is where a move's influence matters most, so this
 * detector measures how a move changes the mover's grip on those four squares
 * and explains the consequence:
 *  - praise (on strong moves): `occupy-center` (a pawn lands in the centre),
 *    `contest-center` (a pawn lever strikes the enemy's central pawns), or
 *    `strong-center` (control jumps to a dominant level, even via a piece);
 *  - criticism (on flawed moves): `loss-of-center` (control is surrendered) or
 *    `missed-break` (the engine's move was a central lever the mover skipped).
 *
 * It works on the CHANGE the move makes (control before vs after), so it never
 * re-comments on a centre that was settled long ago. Tier `heuristic`: the
 * counts are exact, but "good/bad BECAUSE of the centre" is a judgement a
 * concrete tactic or material swing overrules — praise/criticism is gated by
 * the classifier so it never fights the verdict.
 */

import { Board, fileIndex, otherColor, parseUciMove, pieceName, rankIndex } from '../board';
import {
  CENTER_SQUARES,
  centralControlSquares,
  centralPawnCount,
  pawnAttackSquares,
} from '../positional';
import { CRITIQUE_CLASSES, POSITIONAL_CLASSES, PRAISE_CLASSES } from '../classifications';
import { boardsOf } from '../context';
import { ArrowHint, Explanation, Improvement, SignalDetector, SquareHint, Visuals } from '../detector';
import { movers, moversLower, opponentsLower } from '../perspective';
import { joinList } from '../text';
import { Color, MoveClassification, MoveContext } from '../types';

type CenterKind =
  | 'occupy-center'
  | 'contest-center'
  | 'strong-center'
  | 'loss-of-center'
  | 'missed-break';

const PRAISE_KINDS: ReadonlySet<CenterKind> = new Set<CenterKind>(['occupy-center', 'contest-center', 'strong-center']);
/** Is `square` inside the extended centre (files c–f, ranks 3–6)? */
function inExtendedCenter(square: string): boolean {
  const f = fileIndex(square);
  const r = rankIndex(square);
  return f >= 2 && f <= 5 && r >= 3 && r <= 6;
}

/**
 * Is `uci` a central pawn lever for `color` — a pawn move whose destination
 * attacks an enemy pawn standing in the extended centre? (…c5 hitting d4, …f5
 * hitting e4, etc. — the classic way to strike at a pawn centre.)
 */
export function centralLeverTargets(board: Board, uci: string, color: Color): string[] {
  let mv;
  try { mv = parseUciMove(uci); } catch { return []; }
  const p = board.squares.get(mv.from);
  if (!p || p.type !== 'p') return [];
  const enemy = otherColor(color);
  const hits: string[] = [];
  for (const s of pawnAttackSquares(mv.to, color)) {
    const q = board.squares.get(s);
    if (q && q.color === enemy && q.type === 'p' && inExtendedCenter(s)) hits.push(s);
  }
  return hits;
}

export function isCentralLever(board: Board, uci: string, color: Color): boolean {
  return centralLeverTargets(board, uci, color).length > 0;
}

export interface CenterSignals {
  readonly kind: CenterKind | null;
  readonly from: string;
  readonly to: string;
  readonly controlBefore: number;
  readonly controlAfter: number;
  /** Central squares the mover controls AFTER the move (named, for visuals). */
  readonly heldAfter: readonly string[];
  /** Central squares the move gave up (held before, not after). */
  readonly lost: readonly string[];
  /** Name of the piece that moved ("pawn", "knight"). */
  readonly pieceType: string;
  /** For contest-center: the enemy central pawn(s) the lever strikes. */
  readonly leverTargets: readonly string[];
  /** For missed-break: the destination square of the engine's central lever. */
  readonly breakTo: string;
  readonly bestUci: string;
}

const NO_SIGNAL = (bestUci: string): CenterSignals => ({
  kind: null, from: '', to: '', controlBefore: 0, controlAfter: 0,
  heldAfter: [], lost: [], pieceType: 'piece', leverTargets: [], breakTo: '', bestUci,
});

/** Pure signal computation — exported for reuse and direct testing. */
export function computeCenterSignals(ctx: MoveContext): CenterSignals {
  const bestUci = ctx.evalBefore.uci;
  const boards = boardsOf(ctx);
  if (!boards) return NO_SIGNAL(bestUci);
  const { before, after } = boards;
  let from: string;
  let to: string;
  try {
    ({ from, to } = parseUciMove(ctx.uci));
  } catch {
    return NO_SIGNAL(bestUci);
  }
  const me = ctx.mover;
  const heldBefore = centralControlSquares(before, me);
  const heldAfter = centralControlSquares(after, me);
  const controlBefore = heldBefore.length;
  const controlAfter = heldAfter.length;
  const lost = heldBefore.filter((s) => !heldAfter.includes(s));
  const moved = after.squares.get(to);
  const leverTargets = centralLeverTargets(before, ctx.uci, me);
  const base = {
    from, to, controlBefore, controlAfter, heldAfter, lost,
    pieceType: moved ? pieceName(moved.type) : 'piece',
    leverTargets, breakTo: '', bestUci,
  };

  const isPawn = moved?.type === 'p';
  const centralOccGain = centralPawnCount(after, me) > centralPawnCount(before, me);

  if (PRAISE_CLASSES.has(ctx.classification)) {
    if (isPawn && (CENTER_SQUARES as readonly string[]).includes(to) && centralOccGain) {
      return { ...base, kind: 'occupy-center' };
    }
    if (leverTargets.length > 0) {
      return { ...base, kind: 'contest-center' };
    }
    if (controlAfter >= 3 && controlAfter > controlBefore) {
      return { ...base, kind: 'strong-center' };
    }
    return NO_SIGNAL(bestUci);
  }

  if (CRITIQUE_CLASSES.has(ctx.classification)) {
    if (controlBefore - controlAfter >= 2) {
      return { ...base, kind: 'loss-of-center' };
    }
    const playedIsLever = leverTargets.length > 0;
    if (!playedIsLever && controlAfter <= controlBefore && isCentralLever(before, bestUci, me)) {
      let breakTo = '';
      try { breakTo = parseUciMove(bestUci).to; } catch { /* leave blank */ }
      return { ...base, kind: 'missed-break', breakTo };
    }
  }

  return NO_SIGNAL(bestUci);
}

export class CenterControlDetector extends SignalDetector<CenterSignals> {
  readonly id = 'center-control';
  readonly tier = 'heuristic' as const;
  override readonly priority = 6;
  override readonly classifications: readonly MoveClassification[] = POSITIONAL_CLASSES;

  protected computeSignals(ctx: MoveContext): CenterSignals {
    return computeCenterSignals(ctx);
  }

  protected appliesTo(ctx: MoveContext): boolean {
    return this.signals(ctx).kind !== null;
  }

  protected confidence(ctx: MoveContext): number {
    switch (this.signals(ctx).kind) {
      case 'occupy-center': return 0.62;
      case 'loss-of-center': return 0.6;
      case 'strong-center': return 0.6;
      case 'contest-center': return 0.6;
      case 'missed-break': return 0.58;
      default: return 0;
    }
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const san = ctx.san;
    const tags = ['positional', 'center-control', s.kind as string];
    const My = movers(ctx);          // "Your" / "Their"
    const my = moversLower(ctx);
    const their = opponentsLower(ctx);
    const visuals = this.visualsFor(s);

    switch (s.kind) {
      case 'occupy-center':
        return { headline: `${san} occupies the centre.`, tags, visuals,
          summary: `${My} ${s.pieceType} takes ${s.to} in the centre, gaining space and freedom for ${my} pieces.`,
          detail: `A pawn on ${s.to} plants a flag in the classical centre. Central pawns cramp the opponent, hand your pieces more squares to work with, and anchor a space advantage — control the centre and the rest of the board opens up for you.` };
      case 'contest-center':
        return { headline: `${san} strikes at the centre.`, tags, visuals,
          summary: `${My} ${s.pieceType} on ${s.to} hits ${their} centre pawn on ${s.leverTargets[0] ?? 'the centre'}, challenging it before it can roll forward.`,
          detail: `${san} is a pawn lever against the enemy's central pawns. When the opponent builds a big centre, you must hit it with a timely break — otherwise it rolls forward and squeezes you off the board. Challenging the centre keeps the position balanced.` };
      case 'strong-center':
        return { headline: `${san} takes a firm grip on the centre.`, tags, visuals,
          summary: `${My} ${s.pieceType} reaches ${s.to}, taking control of ${joinList(s.heldAfter)} — ${s.controlAfter} of the four central squares.`,
          detail: `After ${san} you control ${s.controlAfter} of the four central squares (up from ${s.controlBefore}). A dominated centre lets your pieces swing to either wing faster than the opponent's — use that space to attack while they stay cramped.` };
      case 'loss-of-center':
        return { headline: `${san} gives up the centre.`, tags, visuals,
          summary: `${My} grip on ${joinList(s.lost)} disappears — ${their} pieces get the central squares and the space that comes with them.`,
          detail: `Your grip on the central squares drops from ${s.controlBefore} to ${s.controlAfter}. Whoever controls the centre dictates the game; conceding it hands the opponent space and free movement for their pieces. Contest the centre before letting it go.` };
      case 'missed-break':
        return { headline: `${san} lets the centre go unchallenged.`, tags, visuals,
          summary: `The pawn break${s.breakTo ? ` to ${s.breakTo}` : ''} was the way to hit ${their} centre; ${san} leaves it standing.`,
          detail: `The engine wanted the central break${s.breakTo ? ` to ${s.breakTo}` : ''}; instead the opponent keeps an unchallenged pawn centre. Against a big centre, hunt for the pawn lever that hits it — a centre you never strike at becomes a steamroller.` };
      default:
        return { headline: san, detail: '', tags };
    }
  }

  /** Arrows/highlights that make the centre claim visible on the board. */
  private visualsFor(s: CenterSignals): Visuals {
    const arrows: ArrowHint[] = [];
    const squares: SquareHint[] = [];
    switch (s.kind) {
      case 'occupy-center':
        if (s.from && s.to) arrows.push({ from: s.from, to: s.to, color: 'idea' });
        squares.push({ square: s.to, color: 'idea' });
        for (const sq of s.heldAfter) if (sq !== s.to) squares.push({ square: sq, color: 'target' });
        break;
      case 'contest-center':
        if (s.from && s.to) arrows.push({ from: s.from, to: s.to, color: 'idea' });
        for (const t of s.leverTargets) {
          arrows.push({ from: s.to, to: t, color: 'danger' });
          squares.push({ square: t, color: 'danger' });
        }
        break;
      case 'strong-center':
        if (s.from && s.to) arrows.push({ from: s.from, to: s.to, color: 'idea' });
        for (const sq of s.heldAfter) squares.push({ square: sq, color: 'idea' });
        break;
      case 'loss-of-center':
        for (const sq of s.lost) squares.push({ square: sq, color: 'danger' });
        break;
      case 'missed-break':
        if (s.bestUci.length >= 4) {
          arrows.push({ from: s.bestUci.slice(0, 2), to: s.bestUci.slice(2, 4), color: 'best' });
        }
        if (s.breakTo) squares.push({ square: s.breakTo, color: 'best' });
        break;
    }
    return { arrows, squares };
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    if ((s.kind === 'missed-break' || s.kind === 'loss-of-center') && s.bestUci && s.bestUci.slice(0, 4) !== ctx.uci.slice(0, 4)) {
      tips.push({ moveUci: s.bestUci, advice: 'Fight for the centre with the engine\'s move instead.' });
    }
    tips.push({
      advice: PRAISE_KINDS.has(s.kind as CenterKind)
        ? 'Keep the centre under control — a space advantage there makes every other plan easier to carry out.'
        : 'Treat the centre as the main battleground: occupy it with pawns, or strike it with a pawn break before the opponent settles in.',
    });
    return tips;
  }
}
