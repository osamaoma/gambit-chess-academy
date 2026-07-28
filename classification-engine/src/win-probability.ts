/**
 * Centipawns → win probability.
 *
 * Classification must not be done on raw centipawns. Going from +100 to 0 is a
 * disaster; going from +900 to +800 is nothing, yet both are "100 centipawns".
 * Win probability is the scale on which a human experiences a mistake, so every
 * band in this engine is expressed in win% rather than centipawns.
 *
 * The model is a logistic curve whose steepness is configurable, so a product
 * can retune it without touching any rule.
 */

import { WinProbabilityConfig } from './config';

/**
 * Win probability (0–100) for the side the score belongs to.
 *
 * @param cp   Centipawns from THAT side's point of view.
 * @param mate Mate distance from that side's point of view, or null.
 *             Positive = this side mates, negative = this side gets mated.
 */
export function winProbability(cp: number, mate: number | null, config: WinProbabilityConfig): number {
  if (mate != null && mate !== 0) {
    return mate > 0 ? config.mateWinPct : 100 - config.mateWinPct;
  }
  const p = 100 / (1 + Math.exp(-config.k * cp));
  return Math.max(0, Math.min(100, p));
}
