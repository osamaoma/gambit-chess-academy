/**
 * PawnStructureDetector — the structural voice.
 *
 * Pawn structure is a property of the whole position, not of one square, so this
 * detector works on the CHANGE the move makes: it compares the pawn skeleton
 * before and after and speaks only when the move actually created or resolved a
 * feature. That keeps it from re-lecturing about a weakness that has sat on the
 * board for twenty moves.
 *
 * It recognises, for the mover:
 *  - praise (on strong moves): a new `passed-pawn`, `connected-passers`, a fresh
 *    wing `pawn-majority`, damage inflicted on the enemy skeleton
 *    (`damaged-enemy-structure`), or a new `strong-chain`;
 *  - criticism (on flawed moves): a self-inflicted `isolated-pawn`,
 *    `doubled-pawns`, `backward-pawn`, or a `weak-chain` (a chain whose base has
 *    become a target).
 *
 * Tier `heuristic`: the structural facts are exact, but "this move was good/bad
 * BECAUSE of the pawns" is a long-term judgement a concrete tactic or material
 * swing can overrule — so verified detectors always outrank it, and praise vs
 * criticism is gated by the classifier so it never contradicts the verdict.
 */

import { Board, fileIndex, rankIndex } from '../board';
import {
  chainBase,
  doubledPawnFiles,
  isBackwardPawn,
  isIsolatedPawn,
  isPassedPawn,
  pawnAttackedByEnemyPawn,
  pawnChains,
  pawnSquares,
  wingPawnCounts,
} from '../positional';
import { CRITIQUE_CLASSES, POSITIONAL_CLASSES, PRAISE_CLASSES } from '../classifications';
import { boardsOf } from '../context';
import { ArrowHint, Explanation, Improvement, SignalDetector, SquareHint, Visuals } from '../detector';
import { movers, opponents } from '../perspective';
import { Color, MoveClassification, MoveContext } from '../types';

type StructureKind =
  | 'passed-pawn'
  | 'connected-passers'
  | 'pawn-majority'
  | 'damaged-enemy-structure'
  | 'strong-chain'
  | 'isolated-pawn'
  | 'doubled-pawns'
  | 'backward-pawn'
  | 'weak-chain';

const PRAISE_KINDS: ReadonlySet<StructureKind> = new Set<StructureKind>([
  'passed-pawn', 'connected-passers', 'pawn-majority', 'damaged-enemy-structure', 'strong-chain',
]);
/** Aggregated pawn-skeleton facts for one colour. */
interface Skeleton {
  readonly isolated: ReadonlySet<string>;
  readonly doubledFiles: ReadonlySet<number>;
  readonly backward: ReadonlySet<string>;
  readonly passed: ReadonlySet<string>;
  readonly connectedPassers: boolean;
  readonly longestChain: number;
  /** A chain (≥2) exists whose base pawn is a target (backward / isolated / pawn-attacked). */
  readonly weakChainBase: boolean;
}

function skeleton(board: Board, color: Color): Skeleton {
  const pawns = pawnSquares(board, color);
  const isolated = new Set(pawns.filter((s) => isIsolatedPawn(board, s, color)));
  const backward = new Set(pawns.filter((s) => isBackwardPawn(board, s, color)));
  const passed = new Set(pawns.filter((s) => isPassedPawn(board, s, color)));

  let connectedPassers = false;
  const pa = [...passed];
  for (let i = 0; i < pa.length && !connectedPassers; i++) {
    for (let j = i + 1; j < pa.length; j++) {
      if (Math.abs(fileIndex(pa[i]!) - fileIndex(pa[j]!)) === 1) { connectedPassers = true; break; }
    }
  }

  const chains = pawnChains(board, color);
  let longestChain = 0;
  let weakChainBase = false;
  for (const c of chains) {
    longestChain = Math.max(longestChain, c.length);
    const base = chainBase(c, color);
    if (backward.has(base) || isolated.has(base) || pawnAttackedByEnemyPawn(board, base, color)) {
      weakChainBase = true;
    }
  }
  return { isolated, doubledFiles: new Set(doubledPawnFiles(board, color)), backward, passed, connectedPassers, longestChain, weakChainBase };
}

export interface StructureSignals {
  readonly kind: StructureKind | null;
  /** A square or file letter naming the feature, for the explanation. */
  readonly subject: string;
  readonly bestUci: string;
}

const NO_SIGNAL = (bestUci: string): StructureSignals => ({ kind: null, subject: '', bestUci });

const fileLetter = (i: number): string => 'abcdefgh'.charAt(i);

/** First element of `after` not present in `before` (structural feature the move introduced). */
function firstNew(after: ReadonlySet<string>, before: ReadonlySet<string>): string | null {
  for (const s of after) if (!before.has(s)) return s;
  return null;
}

/** Pure signal computation — exported for reuse and direct testing. */
export function computeStructureSignals(ctx: MoveContext): StructureSignals {
  const bestUci = ctx.evalBefore.uci;
  const boards = boardsOf(ctx);
  if (!boards) return NO_SIGNAL(bestUci);
  const { before, after } = boards;
  const me = ctx.mover;
  const them: Color = me === 'white' ? 'black' : 'white';
  const mBefore = skeleton(before, me);
  const mAfter = skeleton(after, me);
  const eBefore = skeleton(before, them);
  const eAfter = skeleton(after, them);

  const praise = PRAISE_CLASSES.has(ctx.classification);
  const critique = CRITIQUE_CLASSES.has(ctx.classification);

  if (praise) {
    if (mAfter.connectedPassers && !mBefore.connectedPassers) {
      return { kind: 'connected-passers', subject: '', bestUci };
    }
    if (mAfter.passed.size > mBefore.passed.size) {
      return { kind: 'passed-pawn', subject: firstNew(mAfter.passed, mBefore.passed) ?? '', bestUci };
    }
    // inflicted a NEW weakness on the enemy
    if (eAfter.isolated.size > eBefore.isolated.size || eAfter.doubledFiles.size > eBefore.doubledFiles.size) {
      const kindWord = eAfter.doubledFiles.size > eBefore.doubledFiles.size ? 'doubled' : 'isolated';
      return { kind: 'damaged-enemy-structure', subject: kindWord, bestUci };
    }
    const wingNow = wingPawnCounts(after, me);
    const wingThem = wingPawnCounts(after, them);
    const wingBefore = wingPawnCounts(before, me);
    const wingThemBefore = wingPawnCounts(before, them);
    for (const wing of ['queenside', 'kingside'] as const) {
      const isMajorityNow = wingNow[wing] > wingThem[wing];
      const wasMajority = wingBefore[wing] > wingThemBefore[wing];
      if (isMajorityNow && !wasMajority && wingNow[wing] >= 2) {
        return { kind: 'pawn-majority', subject: wing, bestUci };
      }
    }
    if (mAfter.longestChain >= 3 && mAfter.longestChain > mBefore.longestChain && !mAfter.weakChainBase) {
      return { kind: 'strong-chain', subject: '', bestUci };
    }
    return NO_SIGNAL(bestUci);
  }

  if (critique) {
    if (mAfter.isolated.size > mBefore.isolated.size) {
      return { kind: 'isolated-pawn', subject: firstNew(mAfter.isolated, mBefore.isolated) ?? '', bestUci };
    }
    if (mAfter.doubledFiles.size > mBefore.doubledFiles.size) {
      const f = [...mAfter.doubledFiles].find((x) => !mBefore.doubledFiles.has(x));
      return { kind: 'doubled-pawns', subject: f != null ? fileLetter(f) : '', bestUci };
    }
    if (mAfter.backward.size > mBefore.backward.size) {
      return { kind: 'backward-pawn', subject: firstNew(mAfter.backward, mBefore.backward) ?? '', bestUci };
    }
    if (mAfter.weakChainBase && !mBefore.weakChainBase) {
      return { kind: 'weak-chain', subject: '', bestUci };
    }
  }

  return NO_SIGNAL(bestUci);
}

export class PawnStructureDetector extends SignalDetector<StructureSignals> {
  readonly id = 'pawn-structure';
  readonly tier = 'heuristic' as const;
  override readonly priority = 6;
  override readonly classifications: readonly MoveClassification[] = POSITIONAL_CLASSES;

  protected computeSignals(ctx: MoveContext): StructureSignals {
    return computeStructureSignals(ctx);
  }

  /**
   * Mark the pawn the claim is about. `subject` is a square for the pawn-level
   * features and a file letter / wing name for the rest — only the former can
   * be pointed at, so the others simply draw nothing.
   */
  private visualsFor(s: StructureSignals): Visuals {
    const arrows: ArrowHint[] = [];
    const squares: SquareHint[] = [];
    const good = PRAISE_KINDS.has(s.kind as StructureKind);
    if (/^[a-h][1-8]$/.test(s.subject)) {
      squares.push({ square: s.subject, color: good ? 'idea' : 'danger' });
    } else if (/^[a-h]$/.test(s.subject)) {
      for (let r = 1; r <= 8; r++) squares.push({ square: `${s.subject}${r}`, color: good ? 'idea' : 'danger' });
    }
    return { arrows, squares };
  }

  protected appliesTo(ctx: MoveContext): boolean {
    return this.signals(ctx).kind !== null;
  }

  protected confidence(ctx: MoveContext): number {
    switch (this.signals(ctx).kind) {
      case 'connected-passers': return 0.75;
      case 'passed-pawn': return 0.72;
      case 'damaged-enemy-structure': return 0.65;
      case 'isolated-pawn': return 0.6;
      case 'doubled-pawns': return 0.6;
      case 'backward-pawn': return 0.6;
      case 'pawn-majority': return 0.55;
      case 'strong-chain': return 0.5;
      case 'weak-chain': return 0.5;
      default: return 0;
    }
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const san = ctx.san;
    const on = s.subject ? ` on ${s.subject}` : '';
    const tags = ['positional', 'pawn-structure', s.kind as string];
    const My = movers(ctx);
    const Their = opponents(ctx);
    const visuals = this.visualsFor(s);
    const sum = (summary: string) => summary;

    switch (s.kind) {
      case 'passed-pawn':
        return { headline: `${san} creates a passed pawn.`, tags, visuals,
          summary: sum(`${My} pawn${on} is passed — no enemy pawn can stop it from running.`),
          detail: `The pawn${on} has no enemy pawn left to stop it on its file or the files beside it. Passed pawns are pure energy in the endgame — "passed pawns must be pushed"; every step forward ties down more of the opponent's forces.` };
      case 'connected-passers':
        return { headline: `${san} makes connected passed pawns.`, tags, visuals,
          summary: sum(`${My} passed pawns${on} sit side by side, defending each other as they advance.`),
          detail: `Two passed pawns side by side defend each other's advance, so pieces can't blockade them for free. Connected passers on the 6th or 7th rank are often decisive — they cost the opponent a whole piece to stop.` };
      case 'pawn-majority':
        return { headline: `${san} secures a ${s.subject} majority.`, tags, visuals,
          summary: sum(`${My} extra pawn on the ${s.subject} is a passed pawn waiting to happen.`),
          detail: `You have more pawns than your opponent on the ${s.subject}. A majority is a passed pawn in waiting: advance it as a group — the unopposed pawn first — to manufacture a runner where the enemy can't answer.` };
      case 'damaged-enemy-structure':
        return { headline: `${san} damages the enemy pawns.`, tags, visuals,
          summary: sum(`${san} leaves ${Their.toLowerCase()} pawns ${s.subject} — a weakness they cannot repair.`),
          detail: `Your move leaves the opponent with ${s.subject} pawns — a permanent weakness they can't repair. Play against it: fix the weak pawn in place, trade pieces (not pawns), and pile up on the target in the endgame.` };
      case 'strong-chain':
        return { headline: `${san} builds a strong pawn chain.`, tags, visuals,
          summary: sum(`${My} pawns${on} form a solid defending diagonal, grabbing space and sheltering the pieces behind it.`),
          detail: `Your pawns now form a solid, mutually defending diagonal. A firm chain grabs space and shelters your pieces behind it — play on the flank the chain points toward, where your extra space gives you room to attack.` };
      case 'isolated-pawn':
        return { headline: `${san} leaves an isolated pawn.`, tags, visuals,
          summary: sum(`${My} pawn${on} has no pawn on either neighbouring file — no pawn can ever defend it.`),
          detail: `The pawn${on} has no friendly pawn on either neighbouring file, so no pawn can ever defend it — pieces must babysit it, and the square in front becomes a permanent home for an enemy knight. Isolated pawns give active piece play but are a long-term liability, especially as pieces come off.` };
      case 'doubled-pawns':
        return { headline: `${san} doubles the pawns${s.subject ? ` on the ${s.subject}-file` : ''}.`, tags, visuals,
          summary: sum(`${My} pawns are doubled${s.subject ? ` on the ${s.subject}-file` : ''} — they cannot defend each other and cover fewer squares.`),
          detail: `Two pawns on one file can't defend each other and the front one blocks the back one, so they cover fewer squares and are hard to advance. Sometimes the half-open file you gain is worth it — but as a rule, avoid taking doubled pawns without compensation.` };
      case 'backward-pawn':
        return { headline: `${san} creates a backward pawn.`, tags, visuals,
          summary: sum(`${My} pawn${on} is stuck behind its neighbours with no pawn able to support it forward.`),
          detail: `The pawn${on} has fallen behind its neighbours and can't advance — the square ahead is covered by an enemy pawn and no friendly pawn can support it. On a half-open file it becomes a chronic target for enemy rooks; keep your pawns abreast so none gets left behind.` };
      case 'weak-chain':
        return { headline: `${san} weakens your pawn chain.`, tags, visuals,
          summary: sum(`The base of ${My.toLowerCase()} pawn chain${on} is now a target — take the base and the rest hangs.`),
          detail: `The base of your pawn chain — the rearmost pawn holding it up — is now a target. Attack a chain at its base: once the base falls, the pawns in front of it are left hanging. Reinforce the base or you will spend the game defending it.` };
      default:
        return { headline: san, detail: '', tags };
    }
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    if (!PRAISE_KINDS.has(s.kind as StructureKind) && s.bestUci && s.bestUci.slice(0, 4) !== ctx.uci.slice(0, 4)) {
      tips.push({ moveUci: s.bestUci, advice: 'The engine keeps a healthier pawn structure with a different move.' });
    }
    tips.push({
      advice: PRAISE_KINDS.has(s.kind as StructureKind)
        ? 'Structural assets are permanent — steer toward an endgame where the pawn feature you just earned decides the game.'
        : 'Before a pawn move or a recapture, picture the resulting pawn skeleton: healthy pawns defend each other and leave no fixed targets.',
    });
    return tips;
  }
}
