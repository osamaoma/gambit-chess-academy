import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyUciMove, parseFen, toFen } from '../src/board';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { computeStructureSignals, PawnStructureDetector } from '../src/detectors/pawn-structure';
import { EngineEval, MoveClassification, MoveContext } from '../src/types';
import { makeCtx } from './helpers';

function ev(uci: string): EngineEval {
  return { uci, scoreCp: 15, mateIn: null, pv: [uci], depth: 14, alternatives: [] };
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

const detect = (c: MoveContext) => new PawnStructureDetector().detect(c);

describe('PawnStructureDetector — praise', () => {
  it('creating a passed pawn', () => {
    const r = detect(ctx('4k3/8/5p2/4P3/8/8/8/4K3 w - - 0 1', 'e5f6', { san: 'exf6' }));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.match(r.explanation!.headline, /passed pawn/);
    assert.ok(r.explanation!.tags.includes('passed-pawn'));
  });

  it('connected passed pawns', () => {
    const r = detect(ctx('4k3/8/3pP3/2P5/8/8/8/4K3 w - - 0 1', 'c5d6', { san: 'cxd6', classification: 'best' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /connected passed pawns/);
    assert.equal(r.confidence, 0.75);
  });

  it('a wing pawn majority', () => {
    const r = detect(ctx('4k3/ppp5/8/1N6/8/8/PPP5/4K3 w - - 0 1', 'b5c7', { san: 'Nxc7' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /queenside majority/);
    assert.ok(r.explanation!.tags.includes('pawn-majority'));
  });

  it('damaging the enemy structure', () => {
    const r = detect(ctx('4k3/1pp5/8/N7/8/8/8/4K3 w - - 0 1', 'a5b7', { san: 'Nxb7', classification: 'best' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /damages the enemy pawns/);
    assert.match(r.explanation!.detail, /isolated/);
  });

  it('building a strong chain', () => {
    const r = detect(ctx('4k3/8/8/8/8/2PP4/1P6/4K3 w - - 0 1', 'd3d4', { san: 'd4' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /strong pawn chain/);
  });
});

describe('PawnStructureDetector — criticism', () => {
  it('an isolated pawn', () => {
    const r = detect(ctx('4k3/8/8/8/8/3p4/1PP5/4K3 w - - 0 1', 'c2d3', { san: 'cxd3', classification: 'mistake' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /isolated pawn/);
    assert.ok(r.explanation!.improvements.length >= 1);
  });

  it('doubled pawns', () => {
    const r = detect(ctx('4k3/8/8/8/8/2n5/1PPP4/4K3 w - - 0 1', 'b2c3', { san: 'bxc3', classification: 'inaccuracy' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /doubles the pawns on the c-file/);
    assert.ok(r.explanation!.tags.includes('doubled-pawns'));
  });

  it('a backward pawn', () => {
    const r = detect(ctx('4k3/8/8/4p3/4P3/3P4/2P5/4K3 w - - 0 1', 'c2c4', { san: 'c4', classification: 'mistake' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /backward pawn/);
    assert.match(r.explanation!.detail, /d3/);
  });

  it('a weak pawn chain (attackable base)', () => {
    const r = detect(ctx('4k3/8/8/2p5/3PP3/8/8/4K3 w - - 0 1', 'e4e5', { san: 'e5', classification: 'inaccuracy' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /weakens your pawn chain/);
    assert.ok(r.explanation!.tags.includes('weak-chain'));
  });
});

describe('PawnStructureDetector — gating, deltas & integration', () => {
  it('never praises a structural gain that the classifier called a mistake', () => {
    const asMistake = detect(ctx('4k3/8/5p2/4P3/8/8/8/4K3 w - - 0 1', 'e5f6', { classification: 'mistake' }));
    assert.equal(asMistake.applies, false); // passed-pawn is a praise kind
  });

  it('never criticises a weakness on a move the classifier praised', () => {
    // c2-c4 makes the d3-pawn backward, but backward-pawn is a critique kind —
    // labelled "good" it must stay silent (no praise feature exists here).
    const asGood = detect(ctx('4k3/8/8/4p3/4P3/3P4/2P5/4K3 w - - 0 1', 'c2c4', { classification: 'good' }));
    assert.equal(asGood.applies, false);
  });

  it('stays silent on a move that does not change the pawn skeleton', () => {
    // A quiet knight move; pawns untouched.
    const s = computeStructureSignals(ctx('4k3/8/8/8/8/5N2/PP6/4K3 w - - 0 1', 'f3e5', { classification: 'good' }));
    assert.equal(s.kind, null);
  });

  it('runs through the engine and tags the explanation positionally', () => {
    const registry = new DetectorRegistry().register(new PawnStructureDetector());
    const out = new ExplanationEngine(registry).explainMove(
      ctx('4k3/8/5p2/4P3/8/8/8/4K3 w - - 0 1', 'e5f6', { san: 'exf6', classification: 'good' }),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'pawn-structure');
    assert.ok(out.tags.includes('positional'));
  });
});
