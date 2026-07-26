import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { HangingPieceDetector } from '../src/detectors/hanging-piece';
import {
  computeMaterialSignals,
  MaterialDetector,
} from '../src/detectors/material';
import { EngineEval, MoveClassification, MoveContext, MoveDeltas } from '../src/types';
import { makeCtx } from './helpers';

function best(uci: string): EngineEval {
  return { uci, scoreCp: 40, mateIn: null, pv: [uci], depth: 14, alternatives: [] };
}
/** Deltas that read as "engine is happy" (sound) or "engine says bad" (unsound). */
function deltas(winPctDrop: number, winPctAfter = 55): MoveDeltas {
  return { evalBefore: 0.3, evalAfter: 0.3, evalLoss: 0, winPctBefore: 55, winPctAfter, winPctDrop };
}
function ctx(
  fenBefore: string, uci: string, classification: MoveClassification, d: MoveDeltas,
  bestUci = 'a1a1', fenAfter?: string,
): MoveContext {
  return makeCtx({
    fenBefore, uci, san: uci, classification, deltas: d,
    evalBefore: best(bestUci), mover: 'white',
    ...(fenAfter ? { fenAfter } : {}),
  });
}

/* Shared positions */
const FREE_BISHOP_CAP = '3k4/5n2/8/8/2B5/8/8/4K3 w - - 0 1';        // Bxf7, free knight
const FAVORABLE = '4k3/8/3p4/4n3/8/5N2/8/4R1K1 w - - 0 1';         // Nxe5, +1
const EVEN = '4k3/8/4p3/3p4/4P3/8/8/4K3 w - - 0 1';                // exd5, =
const EXCHANGE_DOWN = '4k3/8/2p5/1b6/8/8/1R6/4K3 w - - 0 1';       // Rxb5, -2
const QUEEN_SAC = '4k3/8/4p3/3n4/8/8/Q7/6K1 w - - 0 1';           // Qxd5, -6
const KNIGHT_OFFER = '4k3/8/4p1p1/8/3N4/8/8/4K3 w - - 0 1';        // Nf5 (non-capture), -3

describe('computeMaterialSignals', () => {
  it('grades a free capture as win-material', () => {
    const s = computeMaterialSignals(ctx(FREE_BISHOP_CAP, 'c4f7', 'best', deltas(0, 70)));
    assert.equal(s.kind, 'win-material');
    assert.equal(s.net, 3);
    assert.equal(s.capturedName, 'knight');
  });

  it('grades a 2-vs-1 capture as a favourable exchange', () => {
    assert.equal(computeMaterialSignals(ctx(FAVORABLE, 'f3e5', 'good', deltas(2))).kind, 'favorable-exchange');
  });

  it('grades a recaptured pawn as an even trade', () => {
    assert.equal(computeMaterialSignals(ctx(EVEN, 'e4d5', 'good', deltas(1))).kind, 'equal-trade');
  });

  it('grades losing the exchange as unfavorable-exchange', () => {
    assert.equal(computeMaterialSignals(ctx(EXCHANGE_DOWN, 'b2b5', 'inaccuracy', deltas(8))).kind, 'unfavorable-exchange');
  });

  it('grades a big losing capture as lose-material', () => {
    assert.equal(computeMaterialSignals(ctx(QUEEN_SAC, 'a2d5', 'blunder', deltas(30, 15))).kind, 'lose-material');
  });

  it('THE SPLIT: identical move is a sacrifice when the engine approves, a blunder when it does not', () => {
    const sac = computeMaterialSignals(ctx(QUEEN_SAC, 'a2d5', 'brilliant', deltas(0, 80)));
    const blunder = computeMaterialSignals(ctx(QUEEN_SAC, 'a2d5', 'blunder', deltas(30, 15)));
    assert.equal(sac.kind, 'sacrifice');
    assert.equal(blunder.kind, 'lose-material');
    assert.equal(sac.net, blunder.net); // same material — only the verdict differs
  });

  it('does not claim "win material" when the engine says the move is bad', () => {
    // Wins a free piece by SEE, but classified a blunder (walks into something):
    // the material story is suppressed rather than misleading the user.
    assert.equal(computeMaterialSignals(ctx(FREE_BISHOP_CAP, 'c4f7', 'blunder', deltas(30, 15))).kind, null);
  });
});

describe('MaterialDetector', () => {
  const d = () => new MaterialDetector();

  it('applies with beginner explanation + coaching tip on losing material', () => {
    const r = d().detect(ctx(QUEEN_SAC, 'a2d5', 'blunder', deltas(30, 15), 'g1h1'));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'verified');
    assert.equal(r.confidence, 0.9);
    assert.match(r.explanation!.headline, /loses material/);
    assert.match(r.explanation!.detail, /down for nothing|add up what you win/);
    assert.ok(r.explanation!.tags.includes('material'));
    assert.equal(r.explanation!.improvements[0]?.moveUci, 'g1h1');
    assert.ok(r.explanation!.improvements.length >= 2);
  });

  it('praises a sound sacrifice and names the payoff in the tip', () => {
    const r = d().detect(ctx(QUEEN_SAC, 'a2d5', 'brilliant', deltas(0, 80)));
    assert.equal(r.applies, true);
    assert.ok(r.confidence >= 0.9);
    assert.match(r.explanation!.headline, /sound sacrifice/);
    assert.match(r.explanation!.detail, /brilliant/);
    assert.ok(r.explanation!.tags.includes('sacrifice'));
    assert.match(r.explanation!.improvements[0]!.advice, /name the payoff|forced mate/);
  });

  it('explains a sound NON-capturing sacrifice', () => {
    const r = d().detect(ctx(KNIGHT_OFFER, 'd4f5', 'great', deltas(2, 60)));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /sound sacrifice/);
  });

  it('does NOT apply to a non-capturing material loss (that is the hanging detector)', () => {
    const r = d().detect(ctx(KNIGHT_OFFER, 'd4f5', 'blunder', deltas(30, 15)));
    assert.equal(r.applies, false);
  });

  it('does not apply to a quiet, safe non-capture', () => {
    const quiet = '4k3/8/8/8/8/5N2/8/4K3 w - - 0 1';
    assert.equal(d().detect(ctx(quiet, 'f3g5', 'good', deltas(1))).applies, false);
  });

  it('recognises an even trade but with low confidence (never the headline)', () => {
    const r = d().detect(ctx(EVEN, 'e4d5', 'good', deltas(1)));
    assert.equal(r.applies, true);
    assert.equal(r.confidence, 0.3);
    assert.match(r.explanation!.headline, /even trade/);
  });

  it('stays out of book/forced/miss classifications', () => {
    const det = d();
    for (const c of ['book', 'forced', 'miss'] as const) {
      assert.equal(det.classifications.includes(c), false);
    }
  });

  it('leads over the hanging detector on a capture blunder (priority), hanging supports', () => {
    const registry = new DetectorRegistry().registerAll([
      new MaterialDetector(),
      new HangingPieceDetector(),
    ]);
    // fenAfter = the position after Qxd5 (queen on d5, now hanging to the e6 pawn).
    const afterQxd5 = '4k3/8/4p3/3Q4/8/8/8/6K1 b - - 0 1';
    const out = new ExplanationEngine(registry).explainMove(
      ctx(QUEEN_SAC, 'a2d5', 'blunder', deltas(30, 15), 'g1h1', afterQxd5),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'material');
    assert.ok(out.sources.includes('hanging-piece')); // both verified; material wins on priority
  });
});
