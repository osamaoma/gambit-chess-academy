/**
 * Strategic priorities — what the POSITION is asking for.
 *
 * Separate from {@link ./theme-detector} on purpose: a theme describes the move
 * that was played, a priority describes the position regardless of it. That
 * distinction is what lets a coach say "this was fine, but the position was
 * asking you to finish developing" — impossible if the two are conflated.
 *
 * Priorities are the only place the engine states a PLAN. Keeping them here,
 * derived from board facts, is what stops the language model inventing plans
 * of its own: it can only restate what this file produced.
 */

import { kingOnHome, otherColor, undevelopedMinors } from '@gambit/explanation-engine';
import type { Board } from '@gambit/explanation-engine';
import type { Color, PositionContext, StrategicPriority } from './types';

export interface PriorityContext {
  readonly board: Board;
  readonly mover: Color;
  readonly position: PositionContext;
}

/** A rule proposes a priority, or stays silent. Pure and independent. */
export type PriorityRule = (ctx: PriorityContext) => StrategicPriority | null;

export interface StrategicPriorityDetector {
  detect(board: Board, mover: Color, position: PositionContext): readonly StrategicPriority[];
}

const p = (id: string, statement: string, weight: number): StrategicPriority => ({ id, statement, weight });

/* ────────────────────────────── standard rules ─────────────────────────────── */

/** Pieces still at home in the opening. */
export const finishDevelopmentRule: PriorityRule = (c) => {
  if (c.position.phase !== 'opening') return null;
  const asleep = undevelopedMinors(c.board, c.mover).length;
  return asleep >= 2 ? p('finish-development', 'bring the remaining pieces into play', 0.6 + asleep * 0.1) : null;
};

/** The king is still in the centre with the game opening up. */
export const kingToSafetyRule: PriorityRule = (c) => {
  if (c.position.phase === 'endgame') return null;
  return kingOnHome(c.board, c.mover)
    ? p('king-safety', 'get the king to safety', 0.85)
    : null;
};

/** Nobody has claimed the open file yet. */
export const contestOpenFileRule: PriorityRule = (c) => {
  const file = c.position.openFiles[0];
  return file ? p('contest-open-file', `put a rook on the open ${file}-file`, 0.55) : null;
};

/** In an endgame the king is a piece; using it is usually the plan. */
export const activateKingRule: PriorityRule = (c) =>
  c.position.phase === 'endgame' ? p('activate-king', 'walk the king towards the action', 0.7) : null;

/** Being ahead on material argues for simplification. */
export const convertMaterialRule: PriorityRule = (c) =>
  c.position.material.moverNet >= 300
    ? p('convert-material', 'trade pieces to convert the extra material', 0.65)
    : null;

/** Being behind argues for the opposite. */
export const seekCounterplayRule: PriorityRule = (c) =>
  c.position.material.moverNet <= -300
    ? p('seek-counterplay', 'keep pieces on and look for active counterplay', 0.6)
    : null;

export const DEFAULT_PRIORITY_RULES: readonly PriorityRule[] = [
  kingToSafetyRule,
  finishDevelopmentRule,
  activateKingRule,
  convertMaterialRule,
  seekCounterplayRule,
  contestOpenFileRule,
];

/* ────────────────────────────── the detector ───────────────────────────────── */

export class DefaultStrategicPriorityDetector implements StrategicPriorityDetector {
  constructor(
    private readonly rules: readonly PriorityRule[] = DEFAULT_PRIORITY_RULES,
    /** A review that lists six plans has no plan. Keep the top few. */
    private readonly maxPriorities = 3,
  ) {}

  detect(board: Board, mover: Color, position: PositionContext): readonly StrategicPriority[] {
    const ctx: PriorityContext = { board, mover, position };
    const out: StrategicPriority[] = [];
    for (const rule of this.rules) {
      try {
        const item = rule(ctx);
        if (item) out.push(item);
      } catch { /* a broken rule must not cost the review its plan */ }
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, this.maxPriorities);
  }
}

/** Re-exported for rules that need the opposing colour. */
export { otherColor };
