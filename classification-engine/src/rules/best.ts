/**
 * Best — the engine's first choice.
 *
 * Also fires within a configurable tolerance, so a product can choose to call a
 * near-identical move "Best" too. The tolerance defaults to zero on every
 * signal, meaning only the actual top move earns it unless you tune it.
 *
 * Sits below Brilliant, Great and Miss: those are usually the best move as
 * well, and each says more.
 */

import { ClassifierConfig, thresholdsFor } from '../config';
import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';

export class BestRule extends BaseRule {
  readonly id = 'best';
  protected readonly rank = 50;

  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean {
    if (ctx.playedBest) return true;
    const t = thresholdsFor(config.quality.best, ctx.analysis.phase, config.quality);
    return ctx.winPctDrop <= t.winPctDrop
      && ctx.centipawnLoss <= t.centipawnLoss
      && ctx.evalSwing <= t.evalSwing;
  }

  classify(ctx: ClassificationContext): RuleVerdict {
    return {
      classification: 'Best',
      confidence: ctx.playedBest ? 0.95 : 0.8,
      reasons: [ctx.playedBest
        ? 'This was the strongest move in the position.'
        : 'As strong as the top move, for practical purposes.'],
      metadata: {
        playedBest: ctx.playedBest,
        winPctDrop: ctx.winPctDrop,
        centipawnLoss: ctx.centipawnLoss,
        evalSwing: ctx.evalSwing,
      },
    };
  }
}
