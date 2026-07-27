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

import { Board, fileIndex, otherColor, parseUciMove, rankIndex } from '../board';
import {
  CENTER_SQUARES,
  centralControlCount,
  centralPawnCount,
  pawnAttackSquares,
} from '../positional';
import { CRITIQUE_CLASSES, PRAISE_CLASSES } from '../classifications';
import { boardsOf } from '../context';
import { Explanation, Improvement, SignalDetector } from '../detector';
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
export function isCentralLever(board: Board, uci: string, color: Color): boolean {
  let mv;
  try { mv = parseUciMove(uci); } catch { return false; }
  const p = board.squares.get(mv.from);
  if (!p || p.type !== 'p') return false;
  const enemy = otherColor(color);
  for (const s of pawnAttackSquares(mv.to, color)) {
    const q = board.squares.get(s);
    if (q && q.color === enemy && q.type === 'p' && inExtendedCenter(s)) return true;
  }
  return false;
}

export interface CenterSignals {
  readonly kind: CenterKind | null;
  readonly to: string;
  readonly controlBefore: number;
  readonly controlAfter: number;
  /** For missed-break: the destination square of the engine's central lever. */
  readonly breakTo: string;
  readonly bestUci: string;
}

const NO_SIGNAL = (bestUci: string): CenterSignals => ({
  kind: null, to: '', controlBefore: 0, controlAfter: 0, breakTo: '', bestUci,
});

/** Pure signal computation — exported for reuse and direct testing. */
export function computeCenterSignals(ctx: MoveContext): CenterSignals {
  const bestUci = ctx.evalBefore.uci;
  const boards = boardsOf(ctx);
  if (!boards) return NO_SIGNAL(bestUci);
  const { before, after } = boards;
  let to: string;
  try {
    ({ to } = parseUciMove(ctx.uci));
  } catch {
    return NO_SIGNAL(bestUci);
  }
  const me = ctx.mover;
  const controlBefore = centralControlCount(before, me);
  const controlAfter = centralControlCount(after, me);
  const base = { to, controlBefore, controlAfter, breakTo: '', bestUci };

  const movedPawn = after.squares.get(to);
  const isPawn = movedPawn?.type === 'p';
  const centralOccGain = centralPawnCount(after, me) > centralPawnCount(before, me);

  if (PRAISE_CLASSES.has(ctx.classification)) {
    if (isPawn && (CENTER_SQUARES as readonly string[]).includes(to) && centralOccGain) {
      return { ...base, kind: 'occupy-center' };
    }
    if (isCentralLever(before, ctx.uci, me)) {
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
    const playedIsLever = isCentralLever(before, ctx.uci, me);
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
  override readonly classifications: readonly MoveClassification[] = ['great', 'best', 'good', 'inaccuracy', 'mistake'];

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

    switch (s.kind) {
      case 'occupy-center':
        return { headline: `${san} occupies the centre.`, tags,
          detail: `A pawn on ${s.to} plants a flag in the classical centre. Central pawns cramp the opponent, hand your pieces more squares to work with, and anchor a space advantage — control the centre and the rest of the board opens up for you.` };
      case 'contest-center':
        return { headline: `${san} strikes at the centre.`, tags,
          detail: `${san} is a pawn lever against the enemy's central pawns. When the opponent builds a big centre, you must hit it with a timely break — otherwise it rolls forward and squeezes you off the board. Challenging the centre keeps the position balanced.` };
      case 'strong-center':
        return { headline: `${san} takes a firm grip on the centre.`, tags,
          detail: `After ${san} you control ${s.controlAfter} of the four central squares (up from ${s.controlBefore}). A dominated centre lets your pieces swing to either wing faster than the opponent's — use that space to attack while they stay cramped.` };
      case 'loss-of-center':
        return { headline: `${san} gives up the centre.`, tags,
          detail: `Your grip on the central squares drops from ${s.controlBefore} to ${s.controlAfter}. Whoever controls the centre dictates the game; conceding it hands the opponent space and free movement for their pieces. Contest the centre before letting it go.` };
      case 'missed-break':
        return { headline: `${san} lets the centre go unchallenged.`, tags,
          detail: `The engine wanted the central break${s.breakTo ? ` to ${s.breakTo}` : ''}; instead the opponent keeps an unchallenged pawn centre. Against a big centre, hunt for the pawn lever that hits it — a centre you never strike at becomes a steamroller.` };
      default:
        return { headline: san, detail: '', tags };
    }
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
