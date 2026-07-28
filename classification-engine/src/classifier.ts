/**
 * The classifier — plumbing only.
 *
 * It owns no chess knowledge and no thresholds. Its whole job is:
 *   build context → ask rules in priority order → shape the winner.
 *
 * That is what makes the engine extensible: a new verdict is a new rule passed
 * to the constructor, and tuning is a config object. Neither requires editing
 * this file.
 */

import { ClassifierConfig, DeepPartial, resolveConfig } from './config';
import { buildContext, ClassificationContext } from './context';
import { ClassificationRule, RuleVerdict } from './rule';
import { BookRule, ForcedRule } from './rules/opening-rules';
import { BestRule, BrilliantRule, GreatRule } from './rules/excellence-rules';
import { MissRule, QualityBandRule } from './rules/error-rules';
import { clamp01, MoveAnalysis, MoveClassification } from './types';

/**
 * The standard rule set, highest priority first.
 *
 * Exported so a host can start from it and add, remove or reorder rules
 * without reconstructing the list from scratch.
 */
export function defaultRules(): ClassificationRule[] {
  return [
    new BookRule(),        // 100 — theory: nothing to grade
    new ForcedRule(),      //  90 — no choice existed
    new BrilliantRule(),   //  80 — sound sacrifice
    new GreatRule(),       //  70 — the only move that worked
    new MissRule(),        //  60 — a win thrown away
    new BestRule(),        //  50 — engine's first choice
    new QualityBandRule(), //   0 — always answers
  ];
}

export class MoveClassifier {
  private readonly rules: readonly ClassificationRule[];
  private readonly config: ClassifierConfig;

  /**
   * @param overrides Threshold overrides; anything omitted keeps its default.
   * @param rules     Rule set to use. Defaults to {@link defaultRules}.
   */
  constructor(overrides: DeepPartial<ClassifierConfig> = {}, rules: readonly ClassificationRule[] = defaultRules()) {
    this.config = resolveConfig(overrides);
    // Sorted here so callers never have to care about registration order.
    this.rules = [...rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  /** Classify one analysed move. Always returns a verdict. */
  classify(analysis: MoveAnalysis): MoveClassification {
    const ctx = buildContext(analysis, this.config);

    for (const rule of this.rules) {
      const verdict = this.safeEvaluate(rule, ctx);
      if (verdict) return this.shape(rule, verdict, ctx);
    }

    // Unreachable with the default rules (QualityBandRule always answers), but
    // a custom rule set might not, and callers should never get undefined.
    return {
      classification: 'Good',
      confidence: 0.1,
      reasons: ['No rule claimed this move.'],
      metadata: { ruleId: null, winPctDrop: ctx.winPctDrop },
    };
  }

  /** Classify a whole game in one call. */
  classifyGame(moves: readonly MoveAnalysis[]): MoveClassification[] {
    return moves.map((m) => this.classify(m));
  }

  /** A broken rule must never take down a review; it simply passes. */
  private safeEvaluate(rule: ClassificationRule, ctx: ClassificationContext): RuleVerdict | null {
    try {
      return rule.evaluate(ctx, this.config);
    } catch {
      return null;
    }
  }

  /**
   * Apply cross-cutting adjustments and assemble the result. A shallow search
   * is the one thing that undermines EVERY rule equally, so the penalty is
   * applied centrally rather than repeated in each of them.
   */
  private shape(rule: ClassificationRule, verdict: RuleVerdict, ctx: ClassificationContext): MoveClassification {
    const shallow = ctx.analysis.depth < this.config.lowDepthThreshold;
    const confidence = clamp01(
      verdict.confidence * (shallow ? this.config.lowDepthConfidencePenalty : 1),
    );
    const reasons = shallow
      ? [...verdict.reasons, 'Based on a shallow search, so this verdict is less certain.']
      : [...verdict.reasons];

    return {
      classification: verdict.classification,
      confidence,
      reasons,
      metadata: {
        ruleId: rule.id,
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
