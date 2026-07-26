import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import {
  computeDevelopmentSignals,
  DevelopmentDetector,
} from '../src/detectors/development';
import { EngineEval, MoveContext } from '../src/types';
import { makeCtx } from './helpers';

/** Minimal EngineEval whose best move is `uci`. */
function best(uci: string): EngineEval {
  return { uci, scoreCp: 40, mateIn: null, pv: [uci], depth: 14, alternatives: [] };
}

/* ── Scenario positions ─────────────────────────────────────────────── */

/** After 1.e4 e5 — White to move; best 2.Nf3 develops; played 2.a3 does not. */
const S_MISSED_DEV = (): MoveContext =>
  makeCtx({
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/P7/1PPP1PPP/RNBQKBNR b KQkq - 0 2',
    san: 'a3', uci: 'a2a3', ply: 3, mover: 'white',
    evalBefore: best('g1f3'), classification: 'inaccuracy',
  });

/** After 1.e4 e5 2.Bc4 Nf6 — played 3.Bb3?! re-moves the bishop (tempo). */
const S_TEMPO = (ply = 5): MoveContext =>
  makeCtx({
    fenBefore: 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3',
    fenAfter: 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/1B6/PPPP1PPP/RNBQK1NR b KQkq - 3 3',
    san: 'Bb3', uci: 'c4b3', ply, mover: 'white',
    evalBefore: best('b1c3'), classification: 'inaccuracy',
  });

/** Move ~8: castling available and best, played 8.h3 instead. */
const S_DELAY_CASTLE = (): MoveContext =>
  makeCtx({
    fenBefore: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 6',
    fenAfter: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N1P/PPP2PP1/R1BQK2R b KQkq - 0 6',
    san: 'h3', uci: 'h2h3', ply: 15, mover: 'white',
    evalBefore: best('e1g1'), classification: 'inaccuracy',
  });

/** Black's turn after 1.e4 e5 2.Nf3 — best 2...Nc6 develops; played 2...h6. */
const S_BLACK = (): MoveContext =>
  makeCtx({
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    fenAfter: 'rnbqkbnr/pppp1pp1/7p/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
    san: 'h6', uci: 'h7h6', ply: 4, mover: 'black',
    evalBefore: best('b8c6'), classification: 'inaccuracy',
  });

describe('computeDevelopmentSignals', () => {
  it('recognises the opening phase and a missed development', () => {
    const s = computeDevelopmentSignals(S_MISSED_DEV());
    assert.equal(s.inOpening, true);
    assert.equal(s.playedFailsToDevelop, true);
    assert.equal(s.bestDevelops, true);
    assert.equal(s.bestDescription, 'knight on g1');
    assert.equal(s.wastesTempo, false);
    assert.deepEqual(s.undeveloped, ['b1', 'c1', 'f1', 'g1']);
  });

  it('recognises a wasted tempo (re-moving a developed piece)', () => {
    const s = computeDevelopmentSignals(S_TEMPO());
    assert.equal(s.wastesTempo, true);
    assert.equal(s.playedFailsToDevelop, true);
  });

  it('recognises delayed castling late in the opening', () => {
    const s = computeDevelopmentSignals(S_DELAY_CASTLE());
    assert.equal(s.delaysCastling, true);
    assert.equal(s.bestIsCastle, true);
    assert.equal(s.bestDescription, 'castling');
  });

  it('is colour-aware (black home squares)', () => {
    const s = computeDevelopmentSignals(S_BLACK());
    assert.equal(s.inOpening, true);
    assert.equal(s.bestDevelops, true);
    assert.equal(s.bestDescription, 'knight on b8');
    assert.equal(s.playedFailsToDevelop, true);
  });
});

describe('DevelopmentDetector', () => {
  const detector = () => new DevelopmentDetector();

  it('applies with confidence, explanation and coaching tips on a missed development', () => {
    const r = detector().detect(S_MISSED_DEV());
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.ok(r.confidence >= 0.6 && r.confidence <= 0.9, `confidence ${r.confidence}`);
    assert.match(r.explanation!.headline, /misses a chance to develop/);
    assert.match(r.explanation!.detail, /knight on g1/);
    assert.ok(r.explanation!.tags.includes('development'));
    // coaching tips: the concrete move + the general principle
    assert.equal(r.explanation!.improvements[0]?.moveUci, 'g1f3');
    assert.match(r.explanation!.improvements[0]!.advice, /Develop the knight on g1/);
    assert.equal(r.explanation!.improvements.length, 2);
  });

  it('flags tempo waste with the tempo tag and headline', () => {
    const r = detector().detect(S_TEMPO());
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /loses a tempo/);
    assert.ok(r.explanation!.tags.includes('tempo'));
  });

  it('flags delayed castling and recommends the castle', () => {
    const r = detector().detect(S_DELAY_CASTLE());
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /postpones castling/);
    assert.ok(r.explanation!.tags.includes('castling'));
    assert.match(r.explanation!.improvements[0]!.advice, /Castle here/);
  });

  it('caps confidence at 0.9 even when every signal fires', () => {
    const r = detector().detect(S_TEMPO(15));   // tempo + delayed castling + best develops
    assert.equal(r.applies, true);
    assert.equal(r.confidence, 0.9);
  });

  it('does not apply outside the opening', () => {
    const r = detector().detect(makeCtx({ ...S_MISSED_DEV(), ply: 40 }));
    assert.equal(r.applies, false);
  });

  it('does not apply when the played move develops', () => {
    const ctx = makeCtx({ ...S_MISSED_DEV(), san: 'Nc3', uci: 'b1c3' });
    assert.equal(detector().detect(ctx).applies, false);
  });

  it('does not apply to captures (concrete play beats principle talk)', () => {
    const ctx = makeCtx({
      fenBefore: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
      san: 'exd5', uci: 'e4d5', ply: 3, mover: 'white',
      evalBefore: best('e4d5'), classification: 'good',
    });
    assert.equal(detector().detect(ctx).applies, false);
  });

  it('respects config overrides (a shorter opening window)', () => {
    const strict = new DevelopmentDetector({ openingMaxPly: 2 });
    assert.equal(strict.detect(S_MISSED_DEV()).applies, false); // ply 3 > 2
  });

  it('stays out of blunder and book classifications', () => {
    const d = detector();
    assert.equal(d.classifications.includes('blunder'), false);
    assert.equal(d.classifications.includes('book'), false);
    assert.ok(d.classifications.includes('inaccuracy'));
  });

  it('integrates end-to-end through the engine', () => {
    const registry = new DetectorRegistry().register(new DevelopmentDetector());
    const out = new ExplanationEngine(registry).explainMove(S_BLACK());
    assert.ok(out);
    assert.equal(out.sources[0], 'development');
    assert.match(out.headline, /h6/);
    assert.ok(out.improvements.length >= 1);        // coaching tip surfaced
    assert.ok(out.tags.includes('opening-principles'));
  });
});
