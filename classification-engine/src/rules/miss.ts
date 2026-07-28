/**
 * Miss — a winning chance, or an outright forced mate, let slip.
 *
 * Ranked above the quality bands because "you were winning and stopped
 * winning" is a different lesson from "that move was inaccurate", even when
 * the measured loss is similar.
 */

import { ClassifierConfig } from '../config';
import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';
import { clamp01 } from '../types';

export class MissRule extends BaseRule {
  readonly id = 'miss';
  protected readonly rank = 60;

  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    if (ctx.playedBest) return false;
    if (this.missedMate(ctx, config)) return true;
    const c = config.miss;
    return ctx.winPctBefore >= c.minWinPctBefore && ctx.winPctDrop >= c.minWinPctDrop;
  }

  classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict {
    if (this.missedMate(ctx, config)) {
      return {
        classification: 'Miss',
        confidence: 0.95,
        reasons: ['There was a forced checkmate available here.'],
        metadata: { mateBefore: ctx.analysis.mateBefore, missedMate: true },
      };
    }
    const c = config.miss;
    const severity = clamp01(ctx.winPctDrop / Math.max(1, 100 - c.minWinPctBefore));
    return {
      classification: 'Miss',
      confidence: clamp01(0.7 + 0.25 * severity),
      reasons: ['A winning opportunity slipped away here.'],
      metadata: { winPctBefore: ctx.winPctBefore, winPctDrop: ctx.winPctDrop, missedMate: false },
    };
  }

  private missedMate(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    return config.miss.missedMateIsMiss && ctx.hadForcedMate && !ctx.deliversMate;
  }
}
