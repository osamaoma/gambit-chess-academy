import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DetectorRegistry } from '../src/registry';
import { FakeDetector } from './helpers';

describe('DetectorRegistry', () => {
  it('registers and retrieves detectors', () => {
    const reg = new DetectorRegistry();
    const d = new FakeDetector({ id: 'a' });
    reg.register(d);
    assert.equal(reg.get('a'), d);
    assert.equal(reg.size, 1);
  });

  it('rejects duplicate ids loudly', () => {
    const reg = new DetectorRegistry().register(new FakeDetector({ id: 'a' }));
    assert.throws(() => reg.register(new FakeDetector({ id: 'a' })), /already registered/);
  });

  it('rejects empty ids', () => {
    assert.throws(() => new DetectorRegistry().register(new FakeDetector({ id: '  ' })));
  });

  it('unregisters', () => {
    const reg = new DetectorRegistry().register(new FakeDetector({ id: 'a' }));
    assert.equal(reg.unregister('a'), true);
    assert.equal(reg.unregister('a'), false);
    assert.equal(reg.size, 0);
  });

  it('orders all() by priority desc, then id asc (deterministic)', () => {
    const reg = new DetectorRegistry().registerAll([
      new FakeDetector({ id: 'b', priority: 1 }),
      new FakeDetector({ id: 'a', priority: 1 }),
      new FakeDetector({ id: 'c', priority: 5 }),
    ]);
    assert.deepEqual(reg.all().map((d) => d.id), ['c', 'a', 'b']);
  });

  it('filters by classification', () => {
    const reg = new DetectorRegistry().registerAll([
      new FakeDetector({ id: 'blunders-only', classifications: ['blunder'] }),
      new FakeDetector({ id: 'errors', classifications: ['mistake', 'blunder'] }),
      new FakeDetector({ id: 'everything' }), // 'all'
    ]);
    assert.deepEqual(
      reg.forClassification('mistake').map((d) => d.id),
      ['errors', 'everything'],
    );
    assert.deepEqual(
      reg.forClassification('blunder').map((d) => d.id),
      ['blunders-only', 'errors', 'everything'],
    );
    assert.deepEqual(reg.forClassification('book').map((d) => d.id), ['everything']);
  });
});
