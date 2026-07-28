/**
 * Detector contract + base class.
 *
 * A detector is one self-contained piece of chess understanding ("hanging
 * piece", "back-rank weakness", "good bishop vs bad bishop"…). Many detectors
 * inspect the SAME move; each independently decides whether it applies, how
 * confident it is, and what it would tell the user. The
 * {@link ../selector | ExplanationSelector} then chooses which voices are heard.
 *
 * Design rules the architecture enforces:
 *  - Detectors are PURE and SYNCHRONOUS: `MoveContext` in, `DetectionResult`
 *    out. All engine I/O happened upstream, so detection is deterministic and
 *    trivially unit-testable.
 *  - Detectors NEVER throw into the pipeline: {@link BaseDetector} converts
 *    any subclass error into a clean "does not apply".
 *  - Heuristic detectors can NEVER outrank verified ones, no matter how
 *    confident they claim to be — see {@link ConfidenceTier} and the selector.
 */

import { clamp01, MoveClassification, MoveContext } from './types';

/**
 * How trustworthy a detector's method is — decided by the AUTHOR, not at
 * runtime. This is the coarse layer of the priority system:
 *
 *  - `certain`   — provably true from the rules of chess (e.g. "only legal move").
 *  - `verified`  — confirmed by board geometry / engine lines (e.g. a piece IS
 *                  en prise; the tactic IS in the PV).
 *  - `heuristic` — best-effort pattern judgement that may occasionally be wrong.
 *
 * The selector ranks by tier FIRST; confidence only orders detectors within
 * the same tier. A `heuristic` at 0.99 still loses to a `verified` at 0.5.
 */
export type ConfidenceTier = 'certain' | 'verified' | 'heuristic';

/** Numeric rank for tiers — single source of truth used by the selector. */
export const TIER_RANK: Readonly<Record<ConfidenceTier, number>> = {
  certain: 3,
  verified: 2,
  heuristic: 1,
};

/**
 * Semantic colour for a visual hint. The HOST maps these to actual pixels, so
 * the engine never hard-codes a theme:
 *  - `idea`   — the point of the move (what it achieves);
 *  - `danger` — a threat, a weakness, or a piece that can be taken;
 *  - `best`   — the engine's recommended move;
 *  - `target` — a square/piece the idea acts upon.
 */
export type HintColor = 'idea' | 'danger' | 'best' | 'target';

/** An arrow to draw on the board, illustrating one claim in the explanation. */
export interface ArrowHint {
  readonly from: string;
  readonly to: string;
  readonly color: HintColor;
}

/** A square to highlight, illustrating one claim in the explanation. */
export interface SquareHint {
  readonly square: string;
  readonly color: HintColor;
}

/**
 * Board annotations that make an explanation concrete. A detector knows exactly
 * WHICH squares its claim is about, so it emits them here rather than leaving
 * the UI to guess — this is what turns "gains space" into a visible idea.
 */
export interface Visuals {
  readonly arrows: readonly ArrowHint[];
  readonly squares: readonly SquareHint[];
}

/** A concrete "play this instead / remember this" suggestion. */
export interface Improvement {
  /** The recommended move, when the advice is about a specific move. */
  readonly moveUci?: string;
  readonly moveSan?: string;
  /** One actionable sentence ("Develop the knight before pushing the h-pawn."). */
  readonly advice: string;
}

/** The human-facing payload a detector produces when it applies. */
export interface Explanation {
  /** One short line, suitable for a badge/tooltip ("This drops the bishop on c5."). */
  readonly headline: string;
  /**
   * ONE short, position-specific sentence naming real pieces and squares —
   * the single line a compact review card shows ("Your knight lands on e5,
   * where no pawn can chase it away."). Falls back to {@link headline} when a
   * detector doesn't provide one.
   */
  readonly summary?: string;
  /** 1–3 sentences of WHY, grounded in chess principles. */
  readonly detail: string;
  /** Zero or more concrete improvements. */
  readonly improvements: readonly Improvement[];
  /** Topic tags for grouping/statistics (kebab-case: "hanging-piece"). */
  readonly tags: readonly string[];
  /** Board arrows/highlights that make the claim visible. */
  readonly visuals?: Visuals;
}

/** What every detector returns for every move — even when it doesn't apply. */
export interface DetectionResult {
  readonly detectorId: string;
  readonly tier: ConfidenceTier;
  /**
   * Fine-grained ordering within a tier when confidences tie. Copied from the
   * detector so the selector can operate on results alone.
   */
  readonly priority: number;
  /** Did this detector find its pattern in this move? */
  readonly applies: boolean;
  /** 0–1. Always 0 when `applies` is false. */
  readonly confidence: number;
  /** Present exactly when `applies` is true. */
  readonly explanation: Explanation | null;
}

/**
 * The full detector contract. Implement via {@link BaseDetector} (preferred —
 * you get result assembly, clamping and error containment for free) or
 * directly, e.g. for exotic adapters.
 */
export interface Detector {
  /** Unique, stable, kebab-case id ("hanging-piece"). Registry enforces uniqueness. */
  readonly id: string;
  /** Trust tier of the METHOD (see {@link ConfidenceTier}). */
  readonly tier: ConfidenceTier;
  /** Higher wins among equal tier+confidence. Default 0. */
  readonly priority: number;
  /**
   * Which classifications this detector cares about, or 'all'. The registry
   * uses this to skip irrelevant detectors cheaply (a "brilliancy anatomy"
   * detector never runs on a book move).
   */
  readonly classifications: readonly MoveClassification[] | 'all';
  /** Analyse one move. MUST NOT mutate `ctx`. */
  detect(ctx: MoveContext): DetectionResult;
}

/** Does `detector` want to see moves of `classification`? (Single shared impl.) */
export function detectorHandles(detector: Detector, classification: MoveClassification): boolean {
  return detector.classifications === 'all' || detector.classifications.includes(classification);
}

/**
 * Base class that owns everything detectors share, so concrete detectors are
 * nothing but chess logic:
 *
 *  - assembles the {@link DetectionResult} (subclasses never build one by hand);
 *  - clamps confidence into [0, 1] and demotes confidence-0 hits to "skip";
 *  - converts any thrown error into a clean non-application, because one broken
 *    detector must never take down a whole game review.
 *
 * Subclasses implement three (plus one optional) protected hooks:
 *
 * ```ts
 * class HangingPieceDetector extends BaseDetector {
 *   readonly id = 'hanging-piece';
 *   readonly tier = 'verified' as const;
 *   protected appliesTo(ctx)   { ... }        // cheap yes/no
 *   protected confidence(ctx)  { ... }        // 0–1, only called when applies
 *   protected explain(ctx)     { ... }        // headline/detail/tags
 *   protected improvements(ctx){ ... }        // optional, defaults to []
 * }
 * ```
 */
export abstract class BaseDetector implements Detector {
  abstract readonly id: string;
  abstract readonly tier: ConfidenceTier;
  readonly priority: number = 0;
  readonly classifications: readonly MoveClassification[] | 'all' = 'all';

  /** Template method — final by convention; override the hooks instead. */
  detect(ctx: MoveContext): DetectionResult {
    try {
      if (!this.appliesTo(ctx)) return this.skip();
      const confidence = clamp01(this.confidence(ctx));
      if (confidence <= 0) return this.skip();
      const body = this.explain(ctx);
      return {
        detectorId: this.id,
        tier: this.tier,
        priority: this.priority,
        applies: true,
        confidence,
        explanation: { ...body, improvements: this.improvements(ctx) },
      };
    } catch {
      // A detector bug degrades to "nothing to say", never to a crash.
      return this.skip();
    }
  }

  /** Cheap structural test: is this detector's pattern present at all? */
  protected abstract appliesTo(ctx: MoveContext): boolean;

  /** How clearly the pattern is present (0–1). Only called after `appliesTo`. */
  protected abstract confidence(ctx: MoveContext): number;

  /** The explanation body (improvements are collected separately). */
  protected abstract explain(ctx: MoveContext): Omit<Explanation, 'improvements'>;

  /** Optional: concrete suggestions. Defaults to none. */
  protected improvements(_ctx: MoveContext): readonly Improvement[] {
    return [];
  }

  private skip(): DetectionResult {
    return {
      detectorId: this.id,
      tier: this.tier,
      priority: this.priority,
      applies: false,
      confidence: 0,
      explanation: null,
    };
  }
}

/**
 * A {@link BaseDetector} whose `appliesTo` / `confidence` / `explain` /
 * `improvements` hooks are all derived from a single, per-move "signals" object.
 *
 * Every concrete detector was independently caching that object in a `WeakMap`
 * and exposing a private `signals()` accessor — identical boilerplate repeated
 * once per detector. This class owns that one concern (compute-once memoisation
 * keyed by the immutable {@link MoveContext}), so subclasses implement only the
 * chess: a pure {@link computeSignals} plus hooks that read `this.signals(ctx)`.
 *
 * ```ts
 * class MyDetector extends SignalDetector<MySignals> {
 *   readonly id = 'my-detector';
 *   readonly tier = 'heuristic' as const;
 *   protected computeSignals(ctx) { return computeMySignals(ctx); } // pure, exported
 *   protected appliesTo(ctx)  { return this.signals(ctx).kind !== null; }
 *   protected confidence(ctx) { ... this.signals(ctx) ... }
 *   protected explain(ctx)    { ... this.signals(ctx) ... }
 * }
 * ```
 */
export abstract class SignalDetector<S> extends BaseDetector {
  private readonly memo = new WeakMap<MoveContext, S>();

  /** Compute this detector's signals for one move. Pure; called at most once per context. */
  protected abstract computeSignals(ctx: MoveContext): S;

  /** Memoised signals — safe (and cheap) to call from every hook. */
  protected signals(ctx: MoveContext): S {
    if (this.memo.has(ctx)) return this.memo.get(ctx) as S;
    const s = this.computeSignals(ctx);
    this.memo.set(ctx, s);
    return s;
  }
}
