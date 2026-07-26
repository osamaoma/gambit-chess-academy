/**
 * MaterialDetector — grades the material outcome of a move and, crucially,
 * tells an intentional SACRIFICE apart from a BLUNDER.
 *
 * The material arithmetic comes from {@link staticExchangeEval}: it resolves the
 * capture battle on the target square and reports how far ahead/behind the mover
 * ends up. From that single number (plus what the move captured) it recognises:
 *
 *   net > 0, engine happy   →  win-material  / favorable-exchange
 *   net = 0 (a capture)     →  equal-trade
 *   net < 0                 →  sacrifice   (if the ENGINE says it's justified)
 *                           →  unfavorable-exchange / lose-material  (if not)
 *
 * The sacrifice-vs-blunder split is the whole point and it is decided by the
 * ENGINE, never by the board: giving up material is a *sacrifice* only when the
 * position stays good for the mover (a brilliant/great classification, or a
 * negligible win% drop). The same move that drops a queen is a brilliancy when
 * the attack crashes through and a blunder when it doesn't — and this detector
 * says so.
 *
 * Tier: `verified` — SEE is exact board arithmetic, and the sacrifice verdict
 * leans on the engine's own eval, so the claim is grounded, not guessed.
 */

import {
  Board,
  parseFen,
  parseUciMove,
  pieceName,
  PIECE_VALUES,
  staticExchangeEval,
} from '../board';
import { BaseDetector, Explanation, Improvement } from '../detector';
import { MoveClassification, MoveContext } from '../types';

export type MaterialKind =
  | 'win-material'
  | 'favorable-exchange'
  | 'equal-trade'
  | 'unfavorable-exchange'
  | 'lose-material'
  | 'sacrifice';

export interface MaterialSignals {
  /** The graded outcome, or null when the move has no material story. */
  readonly kind: MaterialKind | null;
  /** SEE result: pawns the mover ends up ahead (+) or behind (−). */
  readonly net: number;
  /** Value captured by the move itself (0 for a non-capture). */
  readonly captured: number;
  readonly isCapture: boolean;
  /** Did the engine judge a material investment worthwhile? */
  readonly sound: boolean;
  readonly capturedName: string | null;
  readonly movedName: string;
  readonly bestUci: string;
}

const EMPTY: MaterialSignals = {
  kind: null, net: 0, captured: 0, isCapture: false, sound: false,
  capturedName: null, movedName: 'piece', bestUci: '',
};

/** Pure signal computation — exported for reuse and direct testing. */
export function computeMaterialSignals(ctx: MoveContext): MaterialSignals {
  const before: Board = parseFen(ctx.fenBefore);
  const { from, to } = parseUciMove(ctx.uci);
  const moved = before.squares.get(from);
  if (!moved) return EMPTY;

  const targetPiece = before.squares.get(to);
  const isCapture = !!targetPiece && targetPiece.color !== moved.color;
  const captured = isCapture ? PIECE_VALUES[targetPiece!.type] : 0;
  const net = Math.round(staticExchangeEval(before, from, to));

  const c = ctx.classification;
  const d = ctx.deltas;
  // The engine's verdict on whether spending material was justified.
  const sound = c === 'brilliant' || c === 'great' || (d.winPctDrop <= 6 && d.winPctAfter >= 45);
  // Did the engine say the move is simply bad? (guards against calling a move
  // that "wins a pawn" good when it actually walks into a losing tactic).
  const clearlyBad = c === 'mistake' || c === 'blunder' || d.winPctDrop >= 12;

  let kind: MaterialKind | null = null;
  if (net > 0 && !clearlyBad) {
    kind = net >= captured ? 'win-material' : 'favorable-exchange';
  } else if (net === 0 && isCapture) {
    kind = 'equal-trade';
  } else if (net < 0) {
    if (sound) kind = 'sacrifice';
    else if (isCapture && net >= -2) kind = 'unfavorable-exchange';
    else kind = 'lose-material';
  }

  return {
    kind, net, captured, isCapture, sound,
    capturedName: isCapture ? pieceName(targetPiece!.type) : null,
    movedName: pieceName(moved.type),
    bestUci: ctx.evalBefore.uci,
  };
}

export class MaterialDetector extends BaseDetector {
  readonly id = 'material';
  readonly tier = 'verified' as const;
  /** Slightly above hanging-piece: on a capture, the SEE trade grade leads. */
  override readonly priority = 22;
  /** Needs brilliant/great to explain sound sacs; the loss end for the errors. */
  override readonly classifications: readonly MoveClassification[] = [
    'brilliant', 'great', 'best', 'good', 'inaccuracy', 'mistake', 'blunder',
  ];

  private readonly memo = new WeakMap<MoveContext, MaterialSignals>();

  protected appliesTo(ctx: MoveContext): boolean {
    const s = this.signals(ctx);
    if (!s.kind) return false;
    // Non-capture material losses are the hanging detector's job; the material
    // detector only speaks about captures and (sound) sacrifices.
    return s.isCapture || s.kind === 'sacrifice';
  }

  protected confidence(ctx: MoveContext): number {
    const s = this.signals(ctx);
    switch (s.kind) {
      case 'win-material': return 0.9;
      case 'favorable-exchange': return 0.8;
      case 'unfavorable-exchange': return 0.78;
      case 'lose-material': return 0.9;
      case 'equal-trade': return 0.3; // recognised, but rarely the headline
      case 'sacrifice':
        return ctx.classification === 'brilliant' ? 0.92
          : ctx.classification === 'great' ? 0.85
          : 0.7;
      default: return 0;
    }
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const to = parseUciMove(ctx.uci).to;
    const up = pts(Math.abs(s.net));
    const cap = s.capturedName ? `the ${s.capturedName}` : 'material';

    let headline: string;
    let detail: string;
    const tags = ['material', s.kind as string];

    switch (s.kind) {
      case 'win-material':
        headline = `${ctx.san} wins ${cap} for free.`;
        detail = `${ctx.san} takes ${cap} and nothing can recapture — you are simply up ${up}. When an enemy piece is undefended, taking it is usually the best move on the board.`;
        break;
      case 'favorable-exchange':
        headline = `${ctx.san} wins the exchange.`;
        detail = `Once the captures on ${to} are done you come out ahead by ${up}. Small favourable trades pile up — win a few and the extra material decides the game.`;
        tags.push('trade');
        break;
      case 'equal-trade':
        headline = `${ctx.san} is an even trade.`;
        detail = `You swap the ${s.movedName}${s.capturedName ? ` for the ${s.capturedName}` : ''} and material stays level. Trade when it helps you — simplify when you are ahead, or swap off your opponent's most dangerous piece — but keep pieces on when you are the one attacking.`;
        tags.push('trade');
        break;
      case 'unfavorable-exchange':
        headline = `${ctx.san} loses the exchange.`;
        detail = `${ctx.san} grabs ${cap}, but the recapture wins more back and you finish ${up} down. Always count the WHOLE sequence of captures on a square — not just the first one — before you take.`;
        tags.push('trade');
        break;
      case 'lose-material':
        headline = `${ctx.san} loses material.`;
        detail = `Taking ${cap} costs you more than it wins: after the recaptures you are ${up} down for nothing lasting. Before a capture, add up what you win and subtract what the opponent wins back — if that is negative, look for another move.`;
        break;
      case 'sacrifice':
      default:
        headline = `${ctx.san} is a sound sacrifice.`;
        detail = `You give up ${up}${s.capturedName ? ` (taking ${cap} on the way)` : ''}, and the engine agrees the compensation is worth it. A real sacrifice is judged by what you GET — a winning attack, a mating net, or the material back with interest — not by what you give up.${ctx.classification === 'brilliant' ? ' This one is brilliant: hard to spot and completely correct.' : ''}`;
        tags.push('sacrifice');
        break;
    }
    return { headline, detail, tags };
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];

    if (s.kind === 'lose-material' || s.kind === 'unfavorable-exchange') {
      if (s.bestUci && s.bestUci !== ctx.uci) {
        tips.push({ moveUci: s.bestUci, advice: 'The engine keeps material level with this move instead.' });
      }
      tips.push({
        advice: 'Counting habit: on the square you capture, list your attackers and the enemy defenders, then trade them off in your head cheapest-first and tally the result.',
      });
    } else if (s.kind === 'sacrifice') {
      tips.push({
        advice: 'Only sacrifice when you can name the payoff: a forced mate, a decisive attack, or regaining the material. If you cannot, keep the piece.',
      });
    } else if (s.kind === 'win-material' || s.kind === 'favorable-exchange') {
      tips.push({
        advice: 'Now convert: trade pieces (not pawns) to reach an endgame where your extra material wins, and keep every piece defended.',
      });
    } else {
      tips.push({
        advice: 'Before every trade, ask what it changes — good trades follow a plan; aimless ones just help whoever was already better.',
      });
    }
    return tips;
  }

  private signals(ctx: MoveContext): MaterialSignals {
    const hit = this.memo.get(ctx);
    if (hit) return hit;
    const s = computeMaterialSignals(ctx);
    this.memo.set(ctx, s);
    return s;
  }
}

/** "3 points" / "1 point". */
function pts(n: number): string {
  const v = Math.abs(n);
  return `${v} point${v === 1 ? '' : 's'}`;
}
