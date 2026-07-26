/**
 * ExplanationEngine — the orchestrator (stage 4 of the pipeline).
 *
 * For each classified move it:
 *   1. asks the registry which detectors care about this classification,
 *   2. runs every one of them against the shared {@link MoveContext},
 *   3. hands all results to the selector,
 *   4. shapes the winner(s) into a {@link UserExplanation} for the UI.
 *
 * The engine contains NO chess knowledge and NO ranking logic — those live in
 * detectors and the selector respectively. It is pure plumbing, which is what
 * makes the system extensible: new understanding is added by registering
 * detectors, never by editing this file.
 */

import { Detector, DetectionResult, Explanation, Improvement } from './detector';
import { DetectorRegistry } from './registry';
import { ExplanationSelector, Selection } from './selector';
import { MoveClassification, MoveContext } from './types';

/** What the UI renders for one move. */
export interface UserExplanation {
  readonly san: string;
  readonly ply: number;
  readonly classification: MoveClassification;
  /** The winning explanation. */
  readonly headline: string;
  readonly detail: string;
  /** Improvements merged from primary + supporting (primary's first, de-duplicated). */
  readonly improvements: readonly Improvement[];
  /** Union of tags from every surfaced explanation (de-duplicated, order-preserving). */
  readonly tags: readonly string[];
  /** Secondary notes, already ranked. */
  readonly supporting: readonly Explanation[];
  /** Which detectors produced the surfaced content (primary first) — for debugging/telemetry. */
  readonly sources: readonly string[];
  /** Winning confidence, useful for UI hedging ("probably…"). */
  readonly confidence: number;
}

export class ExplanationEngine {
  constructor(
    private readonly registry: DetectorRegistry,
    private readonly selector: ExplanationSelector = new ExplanationSelector(),
  ) {}

  /**
   * Explain one move. Returns null when no detector produced an eligible
   * explanation — callers then fall back to the classifier's stock note
   * ("A mistake — it forfeits part of the advantage."), so the user always
   * sees SOMETHING and detectors only speak when they have real content.
   */
  explainMove(ctx: MoveContext): UserExplanation | null {
    const detectors = this.registry.forClassification(ctx.classification);
    const results = detectors.map((d) => this.safeDetect(d, ctx));
    const selection = this.selector.select(results);
    return this.shape(ctx, selection);
  }

  /** Convenience: explain every move of a reviewed game. */
  explainGame(contexts: readonly MoveContext[]): (UserExplanation | null)[] {
    return contexts.map((ctx) => this.explainMove(ctx));
  }

  /**
   * {@link BaseDetector} already contains subclass errors, but the registry
   * accepts ANY {@link Detector} implementation — this guard is the engine's
   * own safety net for third-party implementations that bypass the base class.
   */
  private safeDetect(detector: Detector, ctx: MoveContext): DetectionResult {
    try {
      return detector.detect(ctx);
    } catch {
      return {
        detectorId: detector.id,
        tier: detector.tier,
        priority: detector.priority,
        applies: false,
        confidence: 0,
        explanation: null,
      };
    }
  }

  /** Merge a selection into the single object the UI consumes. */
  private shape(ctx: MoveContext, selection: Selection): UserExplanation | null {
    const primary = selection.primary;
    if (!primary || !primary.explanation) return null;

    const surfaced = [primary, ...selection.supporting];
    const explanations = surfaced.map((r) => r.explanation as Explanation);

    return {
      san: ctx.san,
      ply: ctx.ply,
      classification: ctx.classification,
      headline: primary.explanation.headline,
      detail: primary.explanation.detail,
      improvements: dedupeImprovements(explanations.flatMap((e) => e.improvements)),
      tags: dedupe(explanations.flatMap((e) => e.tags)),
      supporting: explanations.slice(1),
      sources: surfaced.map((r) => r.detectorId),
      confidence: primary.confidence,
    };
  }
}

/** Order-preserving de-duplication (first occurrence wins). */
function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** De-duplicate improvements by move (or advice text for move-less advice). */
function dedupeImprovements(items: readonly Improvement[]): Improvement[] {
  const seen = new Set<string>();
  const out: Improvement[] = [];
  for (const imp of items) {
    const key = imp.moveUci ?? imp.moveSan ?? imp.advice;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(imp);
  }
  return out;
}
