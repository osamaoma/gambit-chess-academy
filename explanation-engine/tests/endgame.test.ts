import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyUciMove, parseFen, toFen } from '../src/board';
import {
  computeEndgameSignals,
  EndgameDetector,
  haveDirectOpposition,
  isEndgame,
} from '../src/detectors/endgame';
import { EngineEval, MoveClassification, MoveContext, MoveDeltas } from '../src/types';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { makeCtx } from './helpers';

function ev(uci: string): EngineEval {
  return { uci, scoreCp: 30, mateIn: null, pv: [uci], depth: 16, alternatives: [] };
}

function ctx(
  fenBefore: string,
  played: string,
  opts: { best?: string; classification?: MoveClassification; san?: string; evalAfter?: number } = {},
): MoveContext {
  const before = parseFen(fenBefore);
  const c = makeCtx({
    fenBefore,
    fenAfter: toFen(applyUciMove(before, played)),
    uci: played,
    san: opts.san ?? played,
    mover: before.sideToMove,
    classification: opts.classification ?? 'good',
    evalBefore: ev(opts.best ?? played),
  });
  if (opts.evalAfter === undefined) return c;
  const deltas: MoveDeltas = { ...c.deltas, evalAfter: opts.evalAfter };
  return { ...c, deltas };
}

const detect = (c: MoveContext) => new EndgameDetector().detect(c);

describe('endgame primitives', () => {
  it('detects the endgame phase', () => {
    assert.equal(isEndgame(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')), false);
    assert.equal(isEndgame(parseFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')), true);
    assert.equal(isEndgame(parseFen('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1')), true); // Q-endgame: few pieces
  });

  it('detects direct opposition', () => {
    assert.equal(haveDirectOpposition(parseFen('8/8/8/3k4/8/3K4/8/8 b - - 0 1'), 'white'), true);
    assert.equal(haveDirectOpposition(parseFen('8/8/8/3k4/8/4K3/8/8 b - - 0 1'), 'white'), false);
  });
});

describe('EndgameDetector — technique (praise)', () => {
  it('promotion', () => {
    const r = detect(ctx('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q', { san: 'a8=Q', classification: 'best' }));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.match(r.explanation!.headline, /promotes/);
  });

  it('promotion threat (pawn to the 7th)', () => {
    const r = detect(ctx('4k3/8/P7/8/8/8/8/4K3 w - - 0 1', 'a6a7', { san: 'a7' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /threatens to promote/);
  });

  it('outside passed pawn', () => {
    const r = detect(ctx('6k1/8/8/p1p5/1P6/8/8/4K3 w - - 0 1', 'b4a5', { san: 'bxa5' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /outside passed pawn/);
    assert.match(r.explanation!.detail, /a5/);
  });

  it('opposition', () => {
    const r = detect(ctx('8/p3k3/8/8/4K3/8/P7/8 w - - 0 1', 'e4e5', { san: 'Ke5' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /takes the opposition/);
  });

  it('rook to the seventh', () => {
    const r = detect(ctx('4k3/1pp5/8/8/8/8/8/R3K3 w - - 0 1', 'a1a7', { san: 'Ra7' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /rook to the seventh/);
    assert.ok(r.explanation!.tags.includes('rook-activity'));
  });

  it('king activity (centralising)', () => {
    const r = detect(ctx('4k3/7p/8/8/8/8/7P/4K3 w - - 0 1', 'e1e2', { san: 'Ke2' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /activates the king/);
  });

  it('pawn race', () => {
    const r = detect(ctx('7k/8/8/P7/7p/8/8/K7 w - - 0 1', 'a5a6', { san: 'a6' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /pawn race/);
  });

  it('fortress (holding while down material)', () => {
    const r = detect(ctx('5k2/8/8/8/8/8/1r5P/6K1 w - - 0 1', 'g1h1', {
      san: 'Kh1', classification: 'best', evalAfter: -0.3,
    }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /holds the fortress/);
  });
});

describe('EndgameDetector — criticism', () => {
  it('a passive king', () => {
    const r = detect(ctx('4k3/7p/8/8/4K3/8/7P/8 w - - 0 1', 'e4e3', { san: 'Ke3?', classification: 'mistake' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /leaves the king passive/);
    assert.ok(r.explanation!.improvements.length >= 1);
  });
});

describe('EndgameDetector — gating & integration', () => {
  it('does nothing outside an endgame', () => {
    const s = computeEndgameSignals(ctx('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4', { classification: 'good' }));
    assert.equal(s.kind, null);
  });

  it('does not praise a technique move the classifier called a mistake', () => {
    assert.equal(detect(ctx('4k3/8/P7/8/8/8/8/4K3 w - - 0 1', 'a6a7', { classification: 'mistake' })).applies, false);
  });

  it('does not criticise a king move the classifier praised', () => {
    assert.equal(detect(ctx('4k3/7p/8/8/4K3/8/7P/8 w - - 0 1', 'e4e3', { classification: 'good' })).applies, false);
  });

  it('runs through the engine and tags with "endgame"', () => {
    const registry = new DetectorRegistry().register(new EndgameDetector());
    const out = new ExplanationEngine(registry).explainMove(
      ctx('4k3/8/P7/8/8/8/8/4K3 w - - 0 1', 'a6a7', { san: 'a7', classification: 'good' }),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'endgame');
    assert.ok(out.tags.includes('endgame'));
  });
});
