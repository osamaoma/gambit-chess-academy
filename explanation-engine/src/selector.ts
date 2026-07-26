/**
 * ExplanationSelector — the priority system.
 *
 * Many detectors may fire on one move; the user should read ONE primary
 * explanation (plus optionally a couple of supporting notes), not twelve.
 * Selection is a pure, deterministic ranking over {@link DetectionResult}s:
 *
 *   1. Eligibility  — applied, has an explanation, confidence ≥ minConfidence.
 *   2. Tier         — certain > verified > heuristic. This is absolute: a
 *                     heuristic can NEVER outrank a verified/certain result,
 *                     regardless of its confidence score.
 *   3. Priority     — the detector author's fine-grained weight (higher first).
 *   4. Confidence   — how clearly the pattern was present this time.
 *   5. Id           — alphabetical, purely to make ties deterministic.
 *
 * The selector knows nothing about detectors or chess — it ranks result
 * objects. That keeps it reusable (e.g. the puzzle generator can rank the same
 * results with a different config) and trivially testable.
 */

import { DetectionResult, TIER_RANK } from './detector';

export interface SelectionConfig {
  /** Results below this confidence are ignored entirely. */
  readonly minConfidence: number;
  /** How many secondary explanations to surface next to the primary. */
  readonly maxSupporting: number;
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  minConfidence: 0.2,
  maxSupporting: 2,
};

/** The selector's verdict for one move. */
export interface Selection {
  /** The single best explanation, or null when nothing (eligible) applied. */
  readonly primary: DetectionResult | null;
  /** Up to `maxSupporting` further explanations, in rank order. */
  readonly supporting: readonly DetectionResult[];
  /** Every eligible result in rank order (primary first) — for debugging/UI "more". */
  readonly ranked: readonly DetectionResult[];
}

/**
 * Total order over detection results implementing rules 2–5 above.
 * Exported so tests (and any future re-ranker) share the one comparator.
 */
export function compareResults(a: DetectionResult, b: DetectionResult): number {
  return (
    TIER_RANK[b.tier] - TIER_RANK[a.tier] ||
    b.priority - a.priority ||
    b.confidence - a.confidence ||
    a.detectorId.localeCompare(b.detectorId)
  );
}

export class ExplanationSelector {
  private readonly config: SelectionConfig;

  constructor(config: Partial<SelectionConfig> = {}) {
    this.config = { ...DEFAULT_SELECTION_CONFIG, ...config };
    if (this.config.minConfidence < 0 || this.config.minConfidence > 1) {
      throw new Error('minConfidence must be within [0, 1].');
    }
    if (this.config.maxSupporting < 0) {
      throw new Error('maxSupporting must be >= 0.');
    }
  }

  select(results: readonly DetectionResult[]): Selection {
    const ranked = results
      .filter(
        (r) =>
          r.applies &&
          r.explanation !== null &&
          r.confidence >= this.config.minConfidence,
      )
      .sort(compareResults);

    const primary = ranked[0] ?? null;
    const supporting = ranked.slice(1, 1 + this.config.maxSupporting);
    return { primary, supporting, ranked };
  }
}
