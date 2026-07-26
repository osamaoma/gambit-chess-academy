/**
 * DetectorRegistry — the extensibility point of the whole engine.
 *
 * Adding a new piece of chess understanding to the product is exactly one call:
 * `registry.register(new MyDetector())`. Nothing else changes — the engine,
 * selector and UI are all detector-agnostic.
 */

import { Detector, detectorHandles } from './detector';
import { MoveClassification } from './types';

export class DetectorRegistry {
  private readonly byId = new Map<string, Detector>();

  /**
   * Add a detector. Ids must be unique — a duplicate registration is always a
   * programming error, so it throws rather than silently replacing (use
   * {@link unregister} first if hot-swapping is intended).
   */
  register(detector: Detector): this {
    if (!detector.id || !detector.id.trim()) {
      throw new Error('Detector id must be a non-empty string.');
    }
    if (this.byId.has(detector.id)) {
      throw new Error(`Detector id "${detector.id}" is already registered.`);
    }
    this.byId.set(detector.id, detector);
    return this;
  }

  /** Convenience bulk form of {@link register}. */
  registerAll(detectors: Iterable<Detector>): this {
    for (const d of detectors) this.register(d);
    return this;
  }

  /** Remove a detector. Returns true when something was removed. */
  unregister(id: string): boolean {
    return this.byId.delete(id);
  }

  get(id: string): Detector | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * All detectors, ordered by priority (desc) then id (asc). The stable order
   * makes engine output deterministic run-to-run — important for tests and for
   * users comparing two reviews of the same game.
   */
  all(): Detector[] {
    return [...this.byId.values()].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    );
  }

  /**
   * The detectors that want to see a move of the given classification —
   * this is the cheap pre-filter the engine runs before any detection work.
   */
  forClassification(classification: MoveClassification): Detector[] {
    return this.all().filter((d) => detectorHandles(d, classification));
  }
}
