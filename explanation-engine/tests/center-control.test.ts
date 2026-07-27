import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseFen } from '../src/board';
import { centralControlCount, centralPawnCount } from '../src/positional';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { CenterControlDetector, computeCenterSignals, isCentralLever } from '../src/detectors/center-control';
import { MoveContext } from '../src/types';
import { positionalCtx as ctx } from './helpers';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OPEN_E = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'; // after 1.e4 e5
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'; // after 1.d4
const detect = (c: MoveContext) => new CenterControlDetector().detect(c);

describe('centre primitives', () => {
  it('counts central control and pawn occupation', () => {
    const b = parseFen('rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2');
    assert.equal(centralControlCount(b, 'white'), 4); // d4,e4 occupy; d5,e5 attacked
    assert.equal(centralPawnCount(b, 'white'), 2);
  });

  it('recognises a central pawn lever', () => {
    const b = parseFen(AFTER_D4);
    assert.equal(isCentralLever(b, 'c7c5', 'black'), true);  // ...c5 hits d4
    assert.equal(isCentralLever(b, 'a7a6', 'black'), false); // a rook's-pawn nudge is not a lever
  });
});

describe('CenterControlDetector — praise', () => {
  it('occupying the centre', () => {
    const r = detect(ctx(START, 'e2e4', { san: 'e4' }));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.match(r.explanation!.headline, /occupies the centre/);
    assert.ok(r.explanation!.tags.includes('center-control'));
  });

  it('contesting the centre with a lever', () => {
    const r = detect(ctx(AFTER_D4, 'c7c5', { san: 'c5', classification: 'good' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /strikes at the centre/);
    assert.ok(r.explanation!.tags.includes('contest-center'));
  });

  it('a firm central grip via a piece (not a pawn)', () => {
    const r = detect(ctx(OPEN_E, 'g1f3', { san: 'Nf3', classification: 'good' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /firm grip on the centre/);
    assert.match(r.explanation!.detail, /control 4 of the four/);
  });
});

describe('CenterControlDetector — criticism', () => {
  it('losing control of the centre', () => {
    // exf5 drags the only central pawn off the centre with nothing backfilling it.
    const r = detect(ctx('4k3/8/8/5p2/4P3/8/8/4K3 w - - 0 1', 'e4f5', {
      san: 'exf5', classification: 'mistake',
    }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /gives up the centre/);
    assert.match(r.explanation!.detail, /from 2 to 0/);
  });

  it('missing a central break the engine found', () => {
    const r = detect(ctx(AFTER_D4, 'a7a6', { best: 'c7c5', san: 'a6', classification: 'mistake' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /unchallenged/);
    assert.match(r.explanation!.detail, /break to c5/);
    assert.equal(r.explanation!.improvements[0]?.moveUci, 'c7c5');
  });
});

describe('CenterControlDetector — gating & integration', () => {
  it('does not praise a centre move the classifier called a mistake', () => {
    assert.equal(detect(ctx(START, 'e2e4', { classification: 'mistake' })).applies, false);
  });

  it('does not criticise a centre state on a move the classifier praised', () => {
    assert.equal(detect(ctx('4k3/8/8/5p2/4P3/8/8/4K3 w - - 0 1', 'e4f5', { classification: 'good' })).applies, false);
  });

  it('stays quiet on a move that does not touch the centre', () => {
    const s = computeCenterSignals(ctx('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1b1', { classification: 'good' }));
    assert.equal(s.kind, null);
  });

  it('runs through the engine and tags positionally', () => {
    const registry = new DetectorRegistry().register(new CenterControlDetector());
    const out = new ExplanationEngine(registry).explainMove(ctx(START, 'e2e4', { san: 'e4', classification: 'good' }));
    assert.ok(out);
    assert.equal(out.sources[0], 'center-control');
    assert.ok(out.tags.includes('positional'));
  });
});
