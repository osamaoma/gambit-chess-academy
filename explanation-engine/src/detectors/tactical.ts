/**
 * Tactical detectors — the fifth and richest detector family.
 *
 * They analyse the tactic in the ENGINE'S BEST MOVE for the position under
 * review, so one implementation explains both sides of the coin:
 *  - you played the best move (brilliant / great / best) → "well spotted, a fork!";
 *  - you didn't (inaccuracy / mistake / blunder / miss) → "you missed a fork —
 *    here's the move and why it works."
 *
 * To respect the framework's tier rule, the family ships as TWO detectors that
 * share one detection core ({@link detectTactics}) but surface different tiers:
 *  - {@link TacticalDetector} — `verified`: fork, pin, skewer, discovered
 *    attack/check, double attack, x-ray, back-rank, mate/mating-net;
 *  - {@link TacticalMotifDetector} — `heuristic`: overloaded defender,
 *    deflection, decoy.
 *
 * Because the selector always ranks `verified` above `heuristic`, a soft
 * pattern guess can never speak over a proven tactic — exactly the guarantee
 * required. Register both with {@link tacticalDetectors}.
 */

import { applyUciMove, parseFen } from '../board';
import { BaseDetector, ConfidenceTier, Explanation, Improvement } from '../detector';
import { MoveClassification, MoveContext } from '../types';
import { detectTactics, MotifId, TacticFinding } from '../tactics';

/** Classifications worth a tactical lecture (book/forced/excellent are skipped). */
const TACTIC_CLASSIFICATIONS: readonly MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
  'miss',
];

/** Classifications that mean the player erred — used to pick "missed" wording. */
const ERROR_CLASSIFICATIONS: ReadonlySet<MoveClassification> = new Set<MoveClassification>([
  'inaccuracy',
  'mistake',
  'blunder',
  'miss',
]);

/** One coaching sentence per motif — the transferable lesson, not the instance. */
const MOTIF_COACH: Record<MotifId, string> = {
  fork: 'A fork hits two things at once — scan for an enemy king and a loose piece a single knight or queen could attack together.',
  pin: 'A pinned piece cannot move without exposing something more valuable behind it, so pile more attackers onto it — it has to sit still.',
  skewer: 'A skewer hits a valuable piece with a lesser one behind it; force the front piece to move and take what it was shielding.',
  'discovered-attack': 'Discovered attacks make two threats for the price of one — the moving piece threatens while the piece behind it is unveiled.',
  'discovered-check': 'A discovered check is devastating: the opponent must answer the check, so the moving piece can grab material for free.',
  'double-attack': 'Two threats in one move: the opponent can only parry one, so you collect the other.',
  xray: 'X-ray vision counts pressure straight through an enemy piece — it matters the moment the blocker moves or is captured.',
  mate: 'Always look at forcing moves — checks, captures, threats — first. The most forcing of all is checkmate.',
  'mating-net': 'When the enemy king is exposed, stop counting material and calculate checks to the end — a forced mate outweighs everything.',
  'back-rank': 'A king boxed in by its own pawns is mated on the back rank. Give your own king luft (a quiet pawn move) before this happens to you.',
  overloaded: 'A defender doing two jobs is overloaded — attack one of its charges and the other falls.',
  deflection: 'Deflection drags a defender off its post with a threat it must answer, then wins what it left behind.',
  decoy: 'A decoy lures an enemy piece (often the king) onto a fatal square, usually with a sacrifice it can hardly decline.',
};

/**
 * Shared detection: find the tactics in the engine's best move for this
 * position. Memoised per {@link MoveContext} so both detectors compute once.
 */
const CACHE = new WeakMap<MoveContext, readonly TacticFinding[]>();

function tacticsFor(ctx: MoveContext): readonly TacticFinding[] {
  const hit = CACHE.get(ctx);
  if (hit) return hit;
  let findings: readonly TacticFinding[] = [];
  const bestUci = ctx.evalBefore.uci;
  if (/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(bestUci)) {
    try {
      const before = parseFen(ctx.fenBefore);
      const after = applyUciMove(before, bestUci);
      findings = detectTactics(before, after, bestUci, {
        mateIn: ctx.evalBefore.mateIn,
        pv: ctx.evalBefore.pv,
      });
    } catch {
      findings = [];
    }
  }
  CACHE.set(ctx, findings);
  return findings;
}

/** Did the player actually play the engine's best move? (compare from/to only) */
function playedBest(ctx: MoveContext): boolean {
  return ctx.uci.slice(0, 4) === ctx.evalBefore.uci.slice(0, 4);
}

/**
 * Shared body for both tiers: a tactical detector surfaces the strongest finding
 * OF ITS OWN TIER (findings are pre-sorted by confidence).
 */
abstract class AbstractTacticalDetector extends BaseDetector {
  override readonly classifications = TACTIC_CLASSIFICATIONS;

  /** Strongest finding matching this detector's tier, or null. */
  protected pick(ctx: MoveContext): TacticFinding | null {
    return tacticsFor(ctx).find((f) => f.tier === this.tier) ?? null;
  }

  protected appliesTo(ctx: MoveContext): boolean {
    return this.pick(ctx) !== null;
  }

  protected confidence(ctx: MoveContext): number {
    return this.pick(ctx)?.confidence ?? 0;
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const f = this.pick(ctx)!;
    const coach = MOTIF_COACH[f.id];
    const motif = f.label.toLowerCase();
    const tags = ['tactics', f.id, ...(f.id === 'mate' || f.id === 'mating-net' || f.id === 'back-rank' ? ['mate'] : [])];

    if (playedBest(ctx)) {
      return {
        headline: `${ctx.san} — a ${motif}!`,
        detail: `Well spotted: ${f.note}. ${coach}`,
        tags,
      };
    }
    if (ERROR_CLASSIFICATIONS.has(ctx.classification)) {
      return {
        headline: `You missed a ${motif}.`,
        detail: `${capitalise(f.note)}. ${coach}`,
        tags,
      };
    }
    // Played a different but still-fine move — describe without scolding.
    return {
      headline: `The position held a ${motif}.`,
      detail: `${capitalise(f.note)}. ${coach}`,
      tags,
    };
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const f = this.pick(ctx)!;
    const tips: Improvement[] = [];
    if (!playedBest(ctx)) {
      tips.push({
        moveUci: ctx.evalBefore.uci,
        advice: `Play the engine's move: ${f.note}.`,
      });
    }
    tips.push({ advice: MOTIF_COACH[f.id] });
    return tips;
  }
}

/** Verified, board-provable tactics + engine-confirmed mates. Ranks above material. */
export class TacticalDetector extends AbstractTacticalDetector {
  readonly id = 'tactics';
  readonly tier: ConfidenceTier = 'verified';
  override readonly priority = 30;
}

/** Heuristic pattern tactics (overloaded / deflection / decoy). */
export class TacticalMotifDetector extends AbstractTacticalDetector {
  readonly id = 'tactics-pattern';
  readonly tier: ConfidenceTier = 'heuristic';
  override readonly priority = 9;
}

/** Both tactical detectors, ready to register together. */
export function tacticalDetectors(): BaseDetector[] {
  return [new TacticalDetector(), new TacticalMotifDetector()];
}

function capitalise(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
