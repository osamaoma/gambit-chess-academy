/**
 * Tests for the shared detector infrastructure introduced in the hardening pass:
 *  - {@link SignalDetector} compute-once memoisation (the boilerplate every
 *    concrete detector used to carry by hand);
 *  - {@link boardsOf} per-context parse cache (parse each FEN pair once, not
 *    once per detector);
 *  - graceful degradation of real detectors on unparseable positions;
 *  - a black-to-move case, proving the shared path is colour-agnostic.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { boardsOf } from '../src/context';
import { Explanation, Improvement, SignalDetector } from '../src/detector';
import { CenterControlDetector } from '../src/detectors/center-control';
import { HangingPieceDetector } from '../src/detectors/hanging-piece';
import { KingSafetyDetector } from '../src/detectors/king-safety';
import { MaterialDetector } from '../src/detectors/material';
import { MoveContext } from '../src/types';
import { makeCtx, positionalCtx } from './helpers';

const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';

/** A SignalDetector that counts how often its signals are actually computed. */
class ProbeDetector extends SignalDetector<{ ok: boolean }> {
  readonly id = 'probe';
  readonly tier = 'verified' as const;
  computeCalls = 0;

  protected computeSignals(): { ok: boolean } {
    this.computeCalls++;
    return { ok: true };
  }
  protected appliesTo(ctx: MoveContext): boolean {
    return this.signals(ctx).ok;
  }
  protected confidence(ctx: MoveContext): number {
    return this.signals(ctx).ok ? 0.5 : 0;
  }
  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    return { headline: String(this.signals(ctx).ok), detail: '', tags: ['probe'] };
  }
  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    return this.signals(ctx).ok ? [{ advice: 'x' }] : [];
  }
}

describe('SignalDetector — compute-once memoisation', () => {
  it('computes signals exactly once across every hook of a single detect()', () => {
    const p = new ProbeDetector();
    const r = p.detect(makeCtx());
    assert.equal(r.applies, true);           // proves explain + improvements ran too
    assert.equal(p.computeCalls, 1);         // appliesTo/confidence/explain/improvements shared it
  });

  it('reuses the cached signals on a repeated detect() of the same context', () => {
    const p = new ProbeDetector();
    const c = makeCtx();
    p.detect(c);
    p.detect(c);
    assert.equal(p.computeCalls, 1);
  });

  it('recomputes for a distinct context', () => {
    const p = new ProbeDetector();
    p.detect(makeCtx({ uci: 'e2e4' }));
    p.detect(makeCtx({ uci: 'd2d4' }));
    assert.equal(p.computeCalls, 2);
  });
});

describe('boardsOf — per-context parse cache', () => {
  it('parses once and returns the very same board instances on repeat', () => {
    const c = makeCtx();
    const first = boardsOf(c);
    const second = boardsOf(c);
    assert.ok(first);
    assert.equal(first, second);             // same MoveBoards object
    assert.equal(first!.before, second!.before);
    assert.equal(first!.after, second!.after);
  });

  it('caches distinct contexts independently', () => {
    const c1 = makeCtx();
    const c2 = makeCtx({ fenBefore: AFTER_D4 });
    const b1 = boardsOf(c1);
    const b2 = boardsOf(c2);
    assert.ok(b1 && b2);
    assert.notEqual(b1, b2);
    assert.notEqual(b1!.before, b2!.before);
  });

  it('returns null once (and stays null) for a malformed FEN', () => {
    const c = makeCtx({ fenBefore: 'not a valid fen' });
    assert.equal(boardsOf(c), null);
    assert.equal(boardsOf(c), null);         // second call served from cache
  });
});

describe('detectors degrade gracefully on unparseable positions', () => {
  it('every refactored detector skips instead of throwing', () => {
    const bad = makeCtx({ fenBefore: 'garbage', fenAfter: 'garbage', classification: 'blunder' });
    const detectors = [
      new HangingPieceDetector(),
      new MaterialDetector(),
      new KingSafetyDetector(),
      new CenterControlDetector(),
    ];
    for (const d of detectors) {
      const r = d.detect(bad);
      assert.equal(r.applies, false, `${d.id} should skip`);
      assert.equal(r.confidence, 0);
      assert.equal(r.explanation, null);
    }
  });
});

describe('the shared path is colour-agnostic (black to move)', () => {
  it('recognises black occupying the centre with ...d5', () => {
    // 1.Nf3, black to move, plays ...d5 planting a pawn on a central square.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';
    const r = new CenterControlDetector().detect(
      positionalCtx(fen, 'd7d5', { san: 'd5', classification: 'good' }),
    );
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /occupies the centre/);
    assert.ok(r.explanation!.tags.includes('center-control'));
  });
});
