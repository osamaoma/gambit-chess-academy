/**
 * The rule contract.
 *
 * One rule = one reason a move might earn a label. Rules are pure functions of
 * (context, config): they never read globals, never mutate, and never know
 * about each other. Adding a new verdict means writing a new rule and
 * registering it — no existing file changes (open/closed).
 *
 * The classifier asks rules in priority order and takes the first verdict, so a
 * rule that returns non-null is saying "I am certain this label wins", not "I
 * have an opinion". Rules that merely have an opinion return null.
 */

import { ClassifierConfig } from './config';
import { ClassificationContext } from './context';
import { Classification } from './types';

/** What a rule returns when it claims a move. */
export interface RuleVerdict {
  readonly classification: Classification;
  /** 0–1 before any global adjustment (e.g. the shallow-search penalty). */
  readonly confidence: number;
  /** Why, in plain language. Surfaced to the user and to telemetry. */
  readonly reasons: readonly string[];
  /** Extra numbers worth keeping for debugging or the UI. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ClassificationRule {
  /** Stable identifier, used in metadata so a verdict can be traced to its rule. */
  readonly id: string;
  /**
   * Higher runs first. Precedence is a product decision, so it lives on the
   * rule rather than being implied by array order at the registration site.
   */
  readonly priority: number;
  /** Claim the move, or return null to pass. */
  evaluate(ctx: ClassificationContext, config: ClassifierConfig): RuleVerdict | null;
}
