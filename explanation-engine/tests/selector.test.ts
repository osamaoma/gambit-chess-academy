import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ExplanationSelector } from '../src/selector';
import { FakeDetector, FakeSpec, makeCtx } from './helpers';

/** Run fakes and select — the selector consumes results, not detectors. */
function select(specs: FakeSpec[], config?: ConstructorParameters<typeof ExplanationSelector>[0]) {
  const ctx = makeCtx();
  const results = specs.map((s) => new FakeDetector(s).detect(ctx));
  return new ExplanationSelector(config).select(results);
}

describe('ExplanationSelector', () => {
  it('picks the single applying result as primary', () => {
    const sel = select([{ id: 'only' }]);
    assert.equal(sel.primary?.detectorId, 'only');
    assert.deepEqual(sel.supporting, []);
  });

  it('returns null primary when nothing applies', () => {
    const sel = select([{ id: 'a', applies: false }]);
    assert.equal(sel.primary, null);
    assert.deepEqual(sel.ranked, []);
  });

  it('TIER DOMINANCE: a heuristic at 0.99 never outranks a verified at 0.5', () => {
    const sel = select([
      { id: 'guess', tier: 'heuristic', confidence: 0.99 },
      { id: 'proof', tier: 'verified', confidence: 0.5 },
    ]);
    assert.equal(sel.primary?.detectorId, 'proof');
    assert.equal(sel.supporting[0]?.detectorId, 'guess');
  });

  it('certain outranks verified', () => {
    const sel = select([
      { id: 'geo', tier: 'verified', confidence: 1 },
      { id: 'rule', tier: 'certain', confidence: 0.4 },
    ]);
    assert.equal(sel.primary?.detectorId, 'rule');
  });

  it('within a tier, priority beats confidence', () => {
    const sel = select([
      { id: 'confident', tier: 'verified', priority: 0, confidence: 0.95 },
      { id: 'important', tier: 'verified', priority: 10, confidence: 0.6 },
    ]);
    assert.equal(sel.primary?.detectorId, 'important');
  });

  it('within tier+priority, higher confidence wins; id breaks exact ties deterministically', () => {
    const byConf = select([
      { id: 'low', confidence: 0.5 },
      { id: 'high', confidence: 0.9 },
    ]);
    assert.equal(byConf.primary?.detectorId, 'high');

    const byId = select([
      { id: 'zeta', confidence: 0.7 },
      { id: 'alpha', confidence: 0.7 },
    ]);
    assert.equal(byId.primary?.detectorId, 'alpha');
  });

  it('drops results below minConfidence', () => {
    const sel = select([{ id: 'weak', confidence: 0.1 }], { minConfidence: 0.2 });
    assert.equal(sel.primary, null);
  });

  it('caps supporting at maxSupporting but keeps everything in ranked', () => {
    const sel = select(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      { maxSupporting: 1 },
    );
    assert.equal(sel.supporting.length, 1);
    assert.equal(sel.ranked.length, 4);
  });

  it('validates its config', () => {
    assert.throws(() => new ExplanationSelector({ minConfidence: 2 }));
    assert.throws(() => new ExplanationSelector({ maxSupporting: -1 }));
  });
});
