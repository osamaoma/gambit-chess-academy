import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FakeDetector, makeCtx } from './helpers';

describe('BaseDetector', () => {
  it('assembles a full result when the detector applies', () => {
    const d = new FakeDetector({ id: 'a', confidence: 0.7, tags: ['x'] });
    const r = d.detect(makeCtx());
    assert.equal(r.applies, true);
    assert.equal(r.detectorId, 'a');
    assert.equal(r.tier, 'verified');
    assert.equal(r.confidence, 0.7);
    assert.equal(r.explanation?.headline, 'headline from a');
    assert.deepEqual(r.explanation?.tags, ['x']);
    assert.deepEqual(r.explanation?.improvements, []);
  });

  it('returns a clean skip when the detector does not apply', () => {
    const d = new FakeDetector({ id: 'a', applies: false });
    const r = d.detect(makeCtx());
    assert.equal(r.applies, false);
    assert.equal(r.confidence, 0);
    assert.equal(r.explanation, null);
  });

  it('clamps out-of-range confidence into [0,1]', () => {
    const high = new FakeDetector({ id: 'h', confidence: 7 }).detect(makeCtx());
    assert.equal(high.confidence, 1);
    const nan = new FakeDetector({ id: 'n', confidence: NaN }).detect(makeCtx());
    assert.equal(nan.applies, false); // NaN clamps to 0 → treated as skip
  });

  it('treats confidence 0 as "does not apply"', () => {
    const r = new FakeDetector({ id: 'z', confidence: 0 }).detect(makeCtx());
    assert.equal(r.applies, false);
    assert.equal(r.explanation, null);
  });

  it('contains errors thrown from any hook', () => {
    for (const stage of ['appliesTo', 'confidence', 'explain'] as const) {
      const r = new FakeDetector({ id: 'e', throwIn: stage }).detect(makeCtx());
      assert.equal(r.applies, false, `hook ${stage} should degrade to skip`);
      assert.equal(r.explanation, null);
    }
  });

  it('copies priority onto the result so the selector can rank without the registry', () => {
    const r = new FakeDetector({ id: 'p', priority: 9 }).detect(makeCtx());
    assert.equal(r.priority, 9);
  });
});
