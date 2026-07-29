/**
 * The rule engine — plumbing only.
 *
 * It owns no chess knowledge and no thresholds. Its whole job is:
 *
 *   build context → ask EVERY rule whether it applies
 *                 → rank the matches by their own priority()
 *                 → let the winner classify()
 *
 * Every rule is asked, rather than stopping at the first match in a fixed
 * order. That costs a handful of cheap predicate calls and buys two things:
 * the verdict can report every rule that recognised the move (invaluable when
 * a label looks wrong), and priority can depend on the position, since it is
 * only meaningful once the matches are known.
 *
 * Adding a classification means writing a rule and passing it in. Retuning
 * means passing a config. Neither requires editing this file.
 */

import { ClassifierConfig, ClassifierConfigOverrides, resolveConfig } from './config';
import { buildContext, ClassificationContext } from './context';
import { ClassificationRule, RuleVerdict } from './rule';
import { defaultRules } from './rules';
import { clamp01, MoveAnalysis, MoveClassification } from './types';

export { defaultRules };

/** A rule that recognised the move, with the rank it claimed. */
interface Match {
  readonly rule: ClassificationRule;
  readonly priority: number;
}

export class MoveClassifier {
  private readonly rules: readonly ClassificationRule[];
  private readonly config: ClassifierConfig;

  /**
   * @param overrides Threshold overrides; anything omitted keeps its default.
   * @param rules     Rule set to use. Defaults to {@link defaultRules}.
   */
  constructor(
    overrides: ClassifierConfigOverrides = {},
    rules: readonly ClassificationRule[] = defaultRules(),
  ) {
    this.config = resolveConfig(overrides);
    this.rules = [...rules];
  }

  /** Classify one analysed move. Always returns a verdict. */
  classify(analysis: MoveAnalysis): MoveClassification {
    const ctx = buildContext(analysis, this.config);
    const matches = this.matchesFor(ctx);

    // Try matches strongest-first. A rule whose classify() throws yields to the
    // next one rather than taking down the review.
    for (const match of matches) {
      const verdict = this.safeClassify(match.rule, ctx);
      if (verdict) return this.shape(match.rule, verdict, ctx, matches);
    }

    // Only reachable with a custom, non-exhaustive rule set — the defaults
    // always answer, because Blunder has no upper bound.
    return {
      classification: 'Good',
      confidence: 0.1,
      reasons: ['No rule recognised this move.'],
      metadata: { ruleId: null, matchedRules: [], winPctDrop: round(ctx.winPctDrop) },
    };
  }

  /** Classify a whole game in one call. */
  classifyGame(moves: readonly MoveAnalysis[]): MoveClassification[] {
    return moves.map((m) => this.classify(m));
  }

  /**
   * Every rule that recognised the move, strongest claim first.
   *
   * Exposed because it is genuinely useful on its own: it answers "why did
   * this come out as Best rather than Great?" without a debugger.
   */
  matchingRules(analysis: MoveAnalysis): { id: string; priority: number }[] {
    const ctx = buildContext(analysis, this.config);
    return this.matchesFor(ctx).map((m) => ({ id: m.rule.id, priority: m.priority }));
  }

  private matchesFor(ctx: ClassificationContext): Match[] {
    const matches: Match[] = [];
    for (const rule of this.rules) {
      // A rule that throws in applies() is treated as not applying: one broken
      // rule must never decide, or break, a classification.
      let applies = false;
      try { applies = rule.applies(ctx, this.config); } catch { applies = false; }
      if (!applies) continue;

      let priority = Number.NEGATIVE_INFINITY;
      try { priority = rule.priority(ctx, this.config); } catch { priority = Number.NEGATIVE_INFINITY; }
      if (!Number.isFinite(priority)) continue;

      matches.push({ rule, priority });
    }
    // Ties break on id so the same input always produces the same output.
    return matches.sort((a, b) => b.priority - a.priority || a.rule.id.localeCompare(b.rule.id));
  }

  private safeClassify(rule: ClassificationRule, ctx: ClassificationContext): RuleVerdict | null {
    try {
      return rule.classify(ctx, this.config);
    } catch {
      return null;
    }
  }

  /**
   * Apply engine-wide adjustments and assemble the result.
   *
   * A shallow search undermines every rule equally, so the penalty belongs
   * here rather than repeated inside each of them.
   */
  private shape(
    rule: ClassificationRule,
    verdict: RuleVerdict,
    ctx: ClassificationContext,
    matches: readonly Match[],
  ): MoveClassification {
    const shallow = ctx.analysis.depth < this.config.lowDepthThreshold;
    const confidence = clamp01(verdict.confidence * (shallow ? this.config.lowDepthConfidencePenalty : 1));
    const reasons = shallow
      ? [...verdict.reasons, 'Based on a shallow search, so this verdict is less certain.']
      : [...verdict.reasons];

    return {
      classification: verdict.classification,
      confidence,
      reasons,
      metadata: {
        ruleId: rule.id,
        /** Every rule that recognised the move, strongest first. */
        matchedRules: matches.map((m) => m.rule.id),
        depth: ctx.analysis.depth,
        winPctBefore: round(ctx.winPctBefore),
        winPctAfter: round(ctx.winPctAfter),
        winPctDrop: round(ctx.winPctDrop),
        centipawnLoss: ctx.analysis.centipawnLoss,
        playedBest: ctx.playedBest,
        phase: ctx.analysis.phase,
        ply: ctx.ply,
        ...verdict.metadata,
      },
    };
  }
}

const round = (n: number): number => Math.round(n * 10) / 10;
