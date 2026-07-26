/**
 * Test doubles shared by every suite. `FakeDetector` is a configurable stand-in
 * (NOT a real chess detector — the architecture ships without any) that lets
 * each test express "a detector that behaves like X" in one line.
 */

import {
  BaseDetector,
  ConfidenceTier,
  Explanation,
  Improvement,
} from '../src/detector';
import { EngineEval, MoveClassification, MoveContext } from '../src/types';

const NO_LINE: EngineEval = {
  uci: 'e2e4',
  scoreCp: 30,
  mateIn: null,
  pv: ['e2e4'],
  depth: 12,
  alternatives: [],
};

/** A structurally-complete MoveContext; override any field per test. */
export function makeCtx(overrides: Partial<MoveContext> = {}): MoveContext {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    san: 'e4',
    uci: 'e2e4',
    ply: 1,
    mover: 'white',
    evalBefore: NO_LINE,
    evalAfter: NO_LINE,
    classification: 'mistake',
    deltas: {
      evalBefore: 0.3,
      evalAfter: -0.9,
      evalLoss: 1.2,
      winPctBefore: 54,
      winPctAfter: 40,
      winPctDrop: 14,
    },
    ...overrides,
  };
}

export interface FakeSpec {
  id: string;
  tier?: ConfidenceTier;
  priority?: number;
  classifications?: readonly MoveClassification[] | 'all';
  applies?: boolean;
  confidence?: number;
  headline?: string;
  tags?: readonly string[];
  improvements?: readonly Improvement[];
  /** Make a hook throw, to test error containment. */
  throwIn?: 'appliesTo' | 'confidence' | 'explain';
}

export class FakeDetector extends BaseDetector {
  readonly id: string;
  readonly tier: ConfidenceTier;
  override readonly priority: number;
  override readonly classifications: readonly MoveClassification[] | 'all';
  /** How many times detect() reached appliesTo — for filter tests. */
  calls = 0;

  constructor(private readonly spec: FakeSpec) {
    super();
    this.id = spec.id;
    this.tier = spec.tier ?? 'verified';
    this.priority = spec.priority ?? 0;
    this.classifications = spec.classifications ?? 'all';
  }

  protected appliesTo(): boolean {
    this.calls++;
    if (this.spec.throwIn === 'appliesTo') throw new Error('boom');
    return this.spec.applies ?? true;
  }

  protected confidence(): number {
    if (this.spec.throwIn === 'confidence') throw new Error('boom');
    return this.spec.confidence ?? 0.8;
  }

  protected explain(): Omit<Explanation, 'improvements'> {
    if (this.spec.throwIn === 'explain') throw new Error('boom');
    return {
      headline: this.spec.headline ?? `headline from ${this.id}`,
      detail: `detail from ${this.id}`,
      tags: this.spec.tags ?? [this.id],
    };
  }

  protected override improvements(): readonly Improvement[] {
    return this.spec.improvements ?? [];
  }
}
