/**
 * HangingPieceDetector — material safety, the beginner's first lesson.
 *
 * It recognises, for the move under review:
 *  - HANGS CREATED BY THE MOVE — after the played move, a piece of the mover's
 *    is newly winnable: the moved piece itself walked into capture, or a piece
 *    it left behind is now undefended / outnumbered / attacked by something
 *    cheaper;
 *  - MISSED FREE MATERIAL — before the move an enemy piece was hanging, the
 *    engine's best move simply takes it, and the played move didn't.
 *
 * The underlying facts (attackers vs defenders, undefended, cheaper attacker)
 * come from {@link hangingPieces} in the shared board module.
 *
 * Tier: `verified` — attack/defence counts are read directly off the FEN, and
 * the missed-capture claim additionally requires the ENGINE's best move to be
 * the capture. (Pins/x-rays can still produce rare edge cases; the conservative
 * counting rules in `hangingPieces` keep those to a minimum.)
 *
 * Explanations are deliberately beginner-friendly: name the piece and square,
 * say what can take it and why that loses material, and teach the counting
 * habit as the coaching tip.
 */

import {
  Board,
  HangingInfo,
  PIECE_VALUES,
  hangingPieces,
  otherColor,
  parseUciMove,
  pieceName,
} from '../board';
import { boardsOf } from '../context';
import { Explanation, Improvement, SignalDetector } from '../detector';
import { MoveClassification, MoveContext } from '../types';

/** Everything the detector observed about one move — computed once. */
export interface HangingSignals {
  /** Mover's pieces hanging AFTER the move that were not hanging before (worst first). */
  readonly newHangs: readonly HangingInfo[];
  /** True when the moved piece itself is among the new hangs. */
  readonly movedPieceHangs: boolean;
  /** Enemy pieces that were free before the move and that the engine's best move captures. */
  readonly missedCaptures: readonly HangingInfo[];
  readonly bestUci: string;
}

/** Benign "nothing hanging" signals — used when the position can't be parsed. */
const NO_HANG_SIGNAL = (bestUci: string): HangingSignals => ({
  newHangs: [], movedPieceHangs: false, missedCaptures: [], bestUci,
});

/** Pure signal computation — exported for reuse and direct testing. */
export function computeHangingSignals(ctx: MoveContext): HangingSignals {
  const boards = boardsOf(ctx);
  if (!boards) return NO_HANG_SIGNAL(ctx.evalBefore.uci);
  const { before, after } = boards;
  const mover = ctx.mover;
  const played = parseUciMove(ctx.uci);

  // ── Hangs created by the played move ──
  // "Created" = hanging in the after-position on a square that was NOT already
  // a hanging square before the move (a long-ignored weakness isn't news).
  const hangingBefore = new Set(hangingPieces(before, mover).map((h) => h.square));
  const valueAt = (b: Board, square: string): number => {
    const p = b.squares.get(square);
    return p ? PIECE_VALUES[p.type] : 0;
  };
  const capturedValue = valueAt(before, played.to);
  const movedValue = valueAt(before, played.from);

  const newHangs = hangingPieces(after, mover).filter((h) => {
    if (hangingBefore.has(h.square)) return false;
    // Trade exemption: if the moved piece just captured equal-or-greater value,
    // being capturable back is a TRADE, not a hang (e.g. QxQ, exd5).
    if (h.square === played.to && capturedValue >= movedValue) return false;
    return true;
  });

  const movedPieceHangs = newHangs.some((h) => h.square === played.to);

  // ── Missed free material ──
  // Enemy piece hanging before the move + engine's best move captures exactly
  // that square + the played move didn't. Engine agreement keeps us honest:
  // if taking were a trap, the engine wouldn't take.
  const bestUci = ctx.evalBefore.uci;
  let bestTarget: string | null = null;
  try {
    bestTarget = parseUciMove(bestUci).to;
  } catch {
    bestTarget = null;
  }
  const enemyHangs = hangingPieces(before, otherColor(mover));
  const missedCaptures = enemyHangs.filter(
    (h) => h.square === bestTarget && played.to !== h.square,
  );

  return { newHangs, movedPieceHangs, missedCaptures, bestUci };
}

export class HangingPieceDetector extends SignalDetector<HangingSignals> {
  readonly id = 'hanging-piece';
  readonly tier = 'verified' as const;
  /** Concrete material facts outrank principle talk of the same tier. */
  override readonly priority = 20;
  /** Material errors span these; book/best/great etc. have nothing hanging to explain. */
  override readonly classifications: readonly MoveClassification[] = [
    'inaccuracy',
    'mistake',
    'blunder',
    'miss',
  ];

  protected computeSignals(ctx: MoveContext): HangingSignals {
    return computeHangingSignals(ctx);
  }

  protected appliesTo(ctx: MoveContext): boolean {
    const s = this.signals(ctx);
    return s.newHangs.length > 0 || s.missedCaptures.length > 0;
  }

  protected confidence(ctx: MoveContext): number {
    const s = this.signals(ctx);
    let c = 0;
    const worst = s.newHangs[0];
    if (worst) {
      c =
        worst.reason === 'undefended'
          ? worst.value >= 3 ? 0.9 : 0.65   // a free pawn is real but modest
          : worst.reason === 'cheaper-attacker'
            ? 0.85
            : 0.7;                          // outnumbered: counting ignores capture order
    }
    if (s.missedCaptures.length > 0) c = Math.max(c, 0.85);
    if (s.newHangs.length > 0 && s.missedCaptures.length > 0) c += 0.05;
    return Math.min(c, 0.95);
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const { before, after } = boardsOf(ctx)!; // appliesTo already proved the position parses
    const worst = s.newHangs[0];
    const missed = s.missedCaptures[0];

    let headline: string;
    const parts: string[] = [];

    if (worst) {
      const name = pieceName(worst.piece.type);
      headline = s.movedPieceHangs && worst.square === parseUciMove(ctx.uci).to
        ? `${ctx.san} hangs your ${name}.`
        : `${ctx.san} leaves your ${name} on ${worst.square} unprotected.`;
      parts.push(
        `After ${ctx.san}, your ${name} on ${worst.square} ${hangPhrase(after, worst, 'yours')}.`,
      );
      if (missed) {
        parts.push(
          `To make it worse, the enemy ${pieceName(missed.piece.type)} on ${missed.square} was free to take this move.`,
        );
      }
    } else {
      // Missed capture is the story.
      const name = pieceName((missed as HangingInfo).piece.type);
      headline = `You could have won the ${name} on ${(missed as HangingInfo).square}.`;
      parts.push(
        `The ${name} on ${(missed as HangingInfo).square} ${hangPhrase(before, missed as HangingInfo, 'theirs')}. The engine's move simply takes it.`,
      );
    }
    parts.push(
      'A quick habit prevents both mistakes: before every move, count the attackers and defenders of the square you are moving to — and scan whether any enemy piece is free.',
    );

    const tags = ['material', 'hanging-piece'];
    if (s.missedCaptures.length > 0) tags.push('missed-capture');

    return { headline, detail: parts.join(' '), tags };
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    const missed = s.missedCaptures[0];
    if (missed) {
      tips.push({
        moveUci: s.bestUci,
        advice: `Take the ${pieceName(missed.piece.type)} on ${missed.square} — it costs you nothing and wins material.`,
      });
    } else if (s.bestUci && s.bestUci !== ctx.uci) {
      tips.push({
        moveUci: s.bestUci,
        advice: 'The engine keeps every piece protected with this move instead.',
      });
    }
    tips.push({
      advice:
        'Safety check: on the square your piece lands, count enemy attackers vs your defenders. If attackers win the count — or the piece has no defender at all — find a safer square.',
    });
    return tips;
  }
}

/* ────────────────────────── beginner wording ────────────────────────── */

/** "…is attacked and has no defenders — it can be taken for free" etc. */
function hangPhrase(board: Board, h: HangingInfo, whose: 'yours' | 'theirs'): string {
  const cheapestSq = [...h.attackers].sort(
    (a, b) =>
      PIECE_VALUES[(board.squares.get(a)?.type ?? 'p')] -
      PIECE_VALUES[(board.squares.get(b)?.type ?? 'p')],
  )[0];
  const attackerName = cheapestSq ? pieceName(board.squares.get(cheapestSq)?.type ?? 'p') : 'piece';

  switch (h.reason) {
    case 'undefended':
      return whose === 'yours'
        ? `is attacked by the ${attackerName} on ${cheapestSq} and has no defenders — it can be taken for free`
        : `is attacked and has no defenders — it is free to take`;
    case 'cheaper-attacker':
      return `is attacked by a ${attackerName}, which is worth less — even after a recapture, the exchange loses material`;
    case 'outnumbered':
      return `has more attackers than defenders (${h.attackers.length} against ${h.defenders.length}) — after all the captures, that side of the count wins`;
  }
}
