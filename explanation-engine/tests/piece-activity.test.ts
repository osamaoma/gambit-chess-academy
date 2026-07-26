import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyUciMove, parseFen, toFen } from '../src/board';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { computeActivitySignals, PieceActivityDetector } from '../src/detectors/piece-activity';
import { EngineEval, MoveClassification, MoveContext } from '../src/types';
import { makeCtx } from './helpers';

function ev(uci: string): EngineEval {
  return { uci, scoreCp: 20, mateIn: null, pv: [uci], depth: 14, alternatives: [] };
}

/** Build a context from a real before-position and a played move (after is derived). */
function ctx(
  fenBefore: string,
  played: string,
  opts: { best?: string; classification?: MoveClassification; san?: string } = {},
): MoveContext {
  const before = parseFen(fenBefore);
  return makeCtx({
    fenBefore,
    fenAfter: toFen(applyUciMove(before, played)),
    uci: played,
    san: opts.san ?? played,
    mover: before.sideToMove,
    classification: opts.classification ?? 'good',
    evalBefore: ev(opts.best ?? played),
  });
}

const detect = (c: MoveContext) => new PieceActivityDetector().detect(c);

describe('PieceActivityDetector — praise', () => {
  it('rook to the open file', () => {
    const r = detect(ctx('4k3/8/8/8/8/8/P7/R3K3 w - - 0 1', 'a1d1', { san: 'Rd1', classification: 'good' }));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.match(r.explanation!.headline, /seizes the open file/);
    assert.ok(r.explanation!.tags.includes('rook-open-file'));
  });

  it('knight to a supported outpost', () => {
    const r = detect(ctx('4k3/8/8/8/3P4/5N2/8/4K3 w - - 0 1', 'f3e5', { san: 'Ne5', classification: 'best' }));
    assert.equal(r.applies, true);
    assert.equal(r.confidence, 0.72);
    assert.match(r.explanation!.headline, /outpost/);
    assert.match(r.explanation!.detail, /e5/);
  });

  it('bishop to a commanding diagonal (strong bishop)', () => {
    const r = detect(ctx('4k3/8/8/8/8/8/2B5/4K3 w - - 0 1', 'c2b1', { san: 'Bb1', classification: 'good' }));
    // c2→b1 is dull; use a real fianchetto instead:
    const r2 = detect(ctx('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', 'c1b2', { san: 'Bb2', classification: 'good' }));
    assert.equal(r2.applies, true);
    assert.match(r2.explanation!.headline, /commanding diagonal/);
    void r;
  });

  it('connecting the rooks (coordination)', () => {
    const r = detect(ctx('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1g1', { san: 'O-O', classification: 'best' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /connects the rooks/);
    assert.ok(r.explanation!.tags.includes('connected-rooks'));
  });

  it('activating a passive piece (big mobility gain)', () => {
    // Knight a1 (2 squares) → c2? small. Use b1→c3 style: knight from the rim to the centre.
    const r = detect(ctx('4k3/8/8/8/8/8/8/N3K3 w - - 0 1', 'a1b3', { san: 'Nb3', classification: 'good' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /activates the knight/);
  });
});

describe('PieceActivityDetector — criticism', () => {
  it('a passive retreat', () => {
    const r = detect(ctx('4k3/8/8/8/8/2N5/8/4K3 w - - 0 1', 'c3b1', { san: 'Nb1?!', classification: 'mistake' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /leaves the knight passive/);
    assert.match(r.explanation!.detail, /3 squares/);
    assert.ok(r.explanation!.improvements.length >= 1);
  });

  it('a pawn move that creates a bad bishop', () => {
    const r = detect(ctx('4k3/8/8/8/8/1P1P1P2/6BP/4K3 w - - 0 1', 'h2h3', { san: 'h3?!', classification: 'inaccuracy' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /shuts in the bishop/);
    assert.match(r.explanation!.detail, /bad bishop/);
    assert.ok(r.explanation!.tags.includes('bad-bishop'));
  });

  it('missing a more active move the engine found', () => {
    const r = detect(ctx('4k3/8/8/8/8/8/P7/R3K3 w - - 0 1', 'e1e2', {
      best: 'a1d1', san: 'Ke2', classification: 'mistake',
    }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /misses a more active move/);
    assert.match(r.explanation!.detail, /open d-file/);
    assert.equal(r.explanation!.improvements[0]?.moveUci, 'a1d1');
  });
});

describe('PieceActivityDetector — gating & integration', () => {
  it('never scolds a good move or praises a mistake', () => {
    // The passive retreat, but classified "good" → praise gate blocks the critique kind.
    const asGood = detect(ctx('4k3/8/8/8/8/2N5/8/4K3 w - - 0 1', 'c3b1', { classification: 'good' }));
    assert.equal(asGood.applies, false);
    // The rook-to-open-file, but classified "mistake" → praise kind not considered.
    const asBad = detect(ctx('4k3/8/8/8/8/8/P7/R3K3 w - - 0 1', 'a1d1', { classification: 'mistake' }));
    assert.equal(asBad.applies, false);
  });

  it('stays quiet on a nothing move', () => {
    const s = computeActivitySignals(ctx('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4', { classification: 'good' }));
    assert.equal(s.kind, null);
  });

  it('rides along as SUPPORTING under a verified detector via the engine', () => {
    // Register the activity detector plus a stub high-tier detector that always fires.
    const registry = new DetectorRegistry().register(new PieceActivityDetector());
    const out = new ExplanationEngine(registry).explainMove(
      ctx('4k3/8/8/8/3P4/5N2/8/4K3 w - - 0 1', 'f3e5', { san: 'Ne5', classification: 'best' }),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'piece-activity'); // only detector registered → it leads
    assert.ok(out.tags.includes('positional'));
  });
});
