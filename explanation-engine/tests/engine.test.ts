import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Detector } from '../src/detector';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { ExplanationSelector } from '../src/selector';
import { FakeDetector, makeCtx } from './helpers';

describe('ExplanationEngine', () => {
  it('produces a shaped UserExplanation from the winning detector', () => {
    const registry = new DetectorRegistry().registerAll([
      new FakeDetector({ id: 'win', tier: 'verified', confidence: 0.9, tags: ['t1'] }),
      new FakeDetector({ id: 'note', tier: 'heuristic', confidence: 0.8, tags: ['t2'] }),
    ]);
    const engine = new ExplanationEngine(registry);
    const out = engine.explainMove(makeCtx({ san: 'Qxb2', ply: 17, classification: 'blunder' }));

    assert.ok(out);
    assert.equal(out.san, 'Qxb2');
    assert.equal(out.ply, 17);
    assert.equal(out.classification, 'blunder');
    assert.equal(out.headline, 'headline from win');
    assert.equal(out.confidence, 0.9);
    assert.deepEqual(out.sources, ['win', 'note']);
    assert.deepEqual(out.tags, ['t1', 't2']); // merged, order-preserving
    assert.equal(out.supporting.length, 1);
    assert.equal(out.supporting[0]?.detail, 'detail from note');
  });

  it('returns null when nothing applies (caller falls back to the stock note)', () => {
    const registry = new DetectorRegistry().register(
      new FakeDetector({ id: 'silent', applies: false }),
    );
    assert.equal(new ExplanationEngine(registry).explainMove(makeCtx()), null);
  });

  it('only runs detectors registered for the move classification', () => {
    const blunderOnly = new FakeDetector({ id: 'b', classifications: ['blunder'] });
    const allMoves = new FakeDetector({ id: 'a' });
    const registry = new DetectorRegistry().registerAll([blunderOnly, allMoves]);
    const engine = new ExplanationEngine(registry);

    engine.explainMove(makeCtx({ classification: 'good' }));
    assert.equal(blunderOnly.calls, 0, 'classification filter should skip it entirely');
    assert.equal(allMoves.calls, 1);
  });

  it('merges and de-duplicates improvements across surfaced explanations', () => {
    const registry = new DetectorRegistry().registerAll([
      new FakeDetector({
        id: 'first', priority: 1,
        improvements: [{ moveSan: 'Nf3', advice: 'Develop first.' }],
      }),
      new FakeDetector({
        id: 'second',
        improvements: [
          { moveSan: 'Nf3', advice: 'Same move, other words.' },  // dup by move
          { advice: 'Castle early.' },
        ],
      }),
    ]);
    const out = new ExplanationEngine(registry).explainMove(makeCtx());
    assert.ok(out);
    assert.deepEqual(out.improvements.map((i) => i.advice), ['Develop first.', 'Castle early.']);
  });

  it('survives a hostile Detector implementation that bypasses BaseDetector and throws', () => {
    const hostile: Detector = {
      id: 'hostile',
      tier: 'certain',
      priority: 99,
      classifications: 'all',
      detect(){ throw new Error('kaboom'); },
    };
    const registry = new DetectorRegistry().registerAll([
      hostile,
      new FakeDetector({ id: 'ok', confidence: 0.6 }),
    ]);
    const out = new ExplanationEngine(registry).explainMove(makeCtx());
    assert.equal(out?.sources[0], 'ok');
  });

  it('explainGame maps every context, preserving order and nulls', () => {
    const registry = new DetectorRegistry().register(
      new FakeDetector({ id: 'errors-only', classifications: ['blunder'] }),
    );
    const engine = new ExplanationEngine(registry, new ExplanationSelector());
    const out = engine.explainGame([
      makeCtx({ classification: 'blunder', ply: 1 }),
      makeCtx({ classification: 'good', ply: 2 }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.ply, 1);
    assert.equal(out[1], null);
  });
});
