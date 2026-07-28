/**
 * Book — the move is still in opening theory.
 *
 * Ranked above everything: grading a memorised move teaches nothing, and a
 * theoretical pawn sacrifice would otherwise be reported as a blunder.
 */

import { ClassificationContext } from '../context';
import { BaseRule, RuleVerdict } from '../rule';

export class BookRule extends BaseRule {
  readonly id = 'book';
  protected readonly rank = 100;

  applies(ctx: ClassificationContext): boolean {
    return ctx.analysis.opening?.isBook === true;
  }

  classify(ctx: ClassificationContext): RuleVerdict {
    const opening = ctx.analysis.opening;
    return {
      classification: 'Book',
      confidence: 1,
      reasons: [opening?.name ? `Still in opening theory (${opening.name}).` : 'Still in opening theory.'],
      metadata: { openingName: opening?.name ?? null, eco: opening?.eco ?? null },
    };
  }
}
