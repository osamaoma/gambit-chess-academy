/**
 * The rule contract.
 *
 * One rule owns exactly one classification. A rule answers three questions,
 * and keeping them separate is what makes the engine configurable:
 *
 *   applies()   — does this rule recognise the move at all?
 *   priority()  — if several rules recognise it, how strongly does this one
 *                 claim it?
 *   classify()  — the verdict, only ever called on the winner.
 *
 * `priority()` is a METHOD, not a constant, so a rule may rank itself
 * differently depending on the position — an endgame rule can outrank an
 * opening one without either knowing the other exists.
 *
 * Rules are pure functions of (context, config): no globals, no mutation, no
 * knowledge of each other. That independence is what makes them testable in
 * isolation and what lets a host add, drop or reorder them freely.
 */

import { ClassifierConfig } from './config';
import { ClassificationContext } from './context';
import { Classification } from './types';

/** What a rule returns once it has won. */
export interface RuleVerdict {
  readonly classification: Classification;
  /** 0–1, before engine-wide adjustments such as the shallow-search penalty. */
  readonly confidence: number;
  /** Why, in plain language. Surfaced to the user and to telemetry. */
  readonly reasons: readonly string[];
  /** Extra numbers worth keeping for debugging or the UI. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ClassificationRule {
  /** Stable identifier. Appears in metadata so a verdict traces to its rule. */
  readonly id: string;

  /**
   * Does this rule recognise the move? Must be cheap, pure and side-effect
   * free — the engine calls it on every rule for every move.
   */
  applies(ctx: ClassificationContext, config: ClassifierConfig): boolean;

  /**
   * How strongly this rule claims the move. Higher wins. Only consulted for
   * rules that already applied, and may vary with the position.
   */
  priority(ctx: ClassificationContext, config: ClassifierConfig): number;

  /**
   * The verdict. The engine calls this ONLY on the highest-priority match, so
   * it may assume `applies()` returned true and do the expensive work here.
   */
  classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict;
}

/**
 * Convenience base for the common case of a fixed priority.
 *
 * Subclasses that need a context-dependent ranking simply override
 * {@link priority} instead.
 */
export abstract class BaseRule implements ClassificationRule {
  abstract readonly id: string;
  /** Fixed rank used by the default {@link priority} implementation. */
  protected abstract readonly rank: number;

  abstract applies(ctx: ClassificationContext, config: ClassifierConfig): boolean;
  abstract classify(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict;

  priority(_ctx: ClassificationContext, _config: ClassifierConfig): number {
    return this.rank;
  }
}
