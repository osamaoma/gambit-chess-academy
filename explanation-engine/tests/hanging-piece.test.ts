import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { HangingPieceDetector, computeHangingSignals } from '../src/detectors/hanging-piece';
import { DevelopmentDetector } from '../src/detectors/development';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { EngineEval, MoveContext } from '../src/types';
import { makeCtx } from './helpers';

function best(uci: string): EngineEval {
  return { uci, scoreCp: 120, mateIn: null, pv: [uci], depth: 14, alternatives: [] };
}

/* ── Scenarios ──────────────────────────────────────────────────────── */

/**
 * White plays Bc4-d5??, moving the bishop onto a square attacked by the pawn
 * on e6 — the moved piece itself now hangs.
 */
const S_MOVED_HANGS = (): MoveContext =>
  makeCtx({
    fenBefore: '4k3/8/4p3/8/2B5/8/8/4K3 w - - 0 1',
    fenAfter: '4k3/8/4p3/3B4/8/8/8/4K3 b - - 1 1',
    san: 'Bd5', uci: 'c4d5', ply: 11, mover: 'white',
    evalBefore: best('c4b3'), classification: 'blunder',
  });

/**
 * The knight on a4 is attacked by the rook on a8 and defended by the rook on
 * a1 — a fair standoff. Playing Rb1 abandons it: a piece LEFT BEHIND by the
 * move becomes undefended. (The attacker must be equal-or-greater value, or the
 * knight would already count as hanging before the move.)
 */
const S_LEFT_BEHIND = (): MoveContext =>
  makeCtx({
    fenBefore: 'r3k3/8/8/8/N7/8/8/R3K3 w - - 0 1',
    fenAfter: 'r3k3/8/8/8/N7/8/8/1R2K3 b - - 1 1',
    san: 'Rb1', uci: 'a1b1', ply: 15, mover: 'white',
    evalBefore: best('a4c5'), classification: 'mistake',
  });

/**
 * Black's queen on d5 is completely free; the engine's best move is Bxd5.
 * White plays a quiet rook move instead — a missed capture.
 */
const S_MISSED_CAPTURE = (): MoveContext =>
  makeCtx({
    fenBefore: '4k3/8/8/3q4/8/8/6B1/R3K3 w - - 0 1',
    fenAfter: '4k3/8/8/3q4/8/8/6B1/1R2K3 b - - 1 1',
    san: 'Rb1', uci: 'a1b1', ply: 21, mover: 'white',
    evalBefore: best('g2d5'), classification: 'miss',
  });

/** An even trade: white pawn e4 takes the black pawn d5 and is recaptured. */
const S_EVEN_TRADE = (): MoveContext =>
  makeCtx({
    fenBefore: '4k3/8/4p3/3p4/4P3/8/8/4K3 w - - 0 1',
    fenAfter: '4k3/8/4p3/3P4/8/8/8/4K3 b - - 0 1',
    san: 'exd5', uci: 'e4d5', ply: 9, mover: 'white',
    evalBefore: best('e4d5'), classification: 'inaccuracy',
  });

describe('computeHangingSignals', () => {
  it('detects a hang created by the moved piece itself', () => {
    const s = computeHangingSignals(S_MOVED_HANGS());
    assert.equal(s.movedPieceHangs, true);
    assert.equal(s.newHangs[0]?.square, 'd5');
    assert.equal(s.newHangs[0]?.reason, 'undefended');
  });

  it('detects a piece left hanging behind by the move', () => {
    const s = computeHangingSignals(S_LEFT_BEHIND());
    assert.equal(s.movedPieceHangs, false);
    assert.equal(s.newHangs[0]?.square, 'a4');
    assert.equal(s.newHangs[0]?.reason, 'undefended');
  });

  it('detects a missed free capture the engine would take', () => {
    const s = computeHangingSignals(S_MISSED_CAPTURE());
    assert.equal(s.missedCaptures[0]?.square, 'd5');
    assert.equal(s.missedCaptures[0]?.piece.type, 'q');
    assert.equal(s.bestUci, 'g2d5');
  });

  it('does not treat an even trade as a hang', () => {
    const s = computeHangingSignals(S_EVEN_TRADE());
    assert.deepEqual(s.newHangs, []);
  });

  it('ignores a weakness that already existed before the move', () => {
    // The knight on a4 is ALREADY hanging before Ke1-e2; the move does not create it.
    const ctx = makeCtx({
      fenBefore: '4k3/8/8/1p6/N7/8/8/4K3 w - - 0 1',
      fenAfter: '4k3/8/8/1p6/N7/8/4K3/8 b - - 1 1',
      san: 'Ke2', uci: 'e1e2', ply: 17, mover: 'white',
      evalBefore: best('a4c3'), classification: 'mistake',
    });
    assert.deepEqual(computeHangingSignals(ctx).newHangs, []);
  });
});

describe('HangingPieceDetector', () => {
  const d = () => new HangingPieceDetector();

  it('is a verified detector that outranks principle detectors', () => {
    const det = d();
    assert.equal(det.tier, 'verified');
    assert.ok(det.priority > new DevelopmentDetector().priority);
  });

  it('explains a hung piece in beginner language, with a safety-check tip', () => {
    const r = d().detect(S_MOVED_HANGS());
    assert.equal(r.applies, true);
    assert.equal(r.confidence, 0.9);
    assert.match(r.explanation!.headline, /Bd5 hangs your bishop/);
    assert.match(r.explanation!.detail, /no defenders — it can be taken for free/);
    assert.match(r.explanation!.detail, /count the attackers and defenders/);
    assert.ok(r.explanation!.tags.includes('hanging-piece'));
    assert.ok(r.explanation!.tags.includes('material'));
    assert.match(
      r.explanation!.improvements.at(-1)!.advice,
      /count enemy attackers vs your defenders/,
    );
  });

  it('names the abandoned piece when the hang is left behind', () => {
    const r = d().detect(S_LEFT_BEHIND());
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /leaves your knight on a4 unprotected/);
  });

  it('explains a missed capture and recommends taking', () => {
    const r = d().detect(S_MISSED_CAPTURE());
    assert.equal(r.applies, true);
    assert.equal(r.confidence, 0.85);
    assert.match(r.explanation!.headline, /could have won the queen on d5/);
    assert.ok(r.explanation!.tags.includes('missed-capture'));
    assert.equal(r.explanation!.improvements[0]?.moveUci, 'g2d5');
    assert.match(r.explanation!.improvements[0]!.advice, /Take the queen on d5/);
  });

  it('scores a hung pawn lower than a hung piece', () => {
    // b2-b4 steps onto the 4th rank, straight into the black rook on h4.
    const pawnHang = makeCtx({
      fenBefore: '4k3/8/8/8/7r/8/1P6/4K3 w - - 0 1',
      fenAfter: '4k3/8/8/8/1P5r/8/8/4K3 b - - 0 1',
      san: 'b4', uci: 'b2b4', ply: 25, mover: 'white',
      evalBefore: best('e1f2'), classification: 'inaccuracy',
    });
    const r = d().detect(pawnHang);
    assert.equal(r.applies, true);
    assert.equal(r.confidence, 0.65);   // undefended pawn < undefended piece (0.9)
  });

  it('does not apply to an even trade', () => {
    assert.equal(d().detect(S_EVEN_TRADE()).applies, false);
  });

  it('only handles material-losing classifications', () => {
    const det = d();
    assert.ok(det.classifications.includes('blunder'));
    assert.ok(det.classifications.includes('miss'));
    assert.equal(det.classifications.includes('book'), false);
    assert.equal(det.classifications.includes('brilliant'), false);
  });

  it('degrades safely on a malformed context instead of throwing', () => {
    const bad = makeCtx({ ...S_MOVED_HANGS(), fenAfter: 'not-a-fen' });
    assert.equal(d().detect(bad).applies, false);
  });
});

describe('framework integration', () => {
  it('beats the development detector on the same move (verified > heuristic)', () => {
    // An opening move that both hangs a piece AND ignores development.
    const ctx = makeCtx({
      fenBefore: 'rnbqkbnr/pppp1ppp/4p3/8/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 3',
      fenAfter: 'rnbqkbnr/pppp1ppp/4p3/3B4/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 3',
      san: 'Bd5', uci: 'c4d5', ply: 5, mover: 'white',
      evalBefore: best('g1f3'), classification: 'mistake',
    });
    const registry = new DetectorRegistry().registerAll([
      new HangingPieceDetector(),
      new DevelopmentDetector(),
    ]);
    const out = new ExplanationEngine(registry).explainMove(ctx);
    assert.ok(out);
    assert.equal(out.sources[0], 'hanging-piece');       // material fact leads
    assert.ok(out.sources.includes('development'));       // principle note supports
    assert.ok(out.tags.includes('material'));
    assert.ok(out.tags.includes('development'));
  });

  it('returns null when neither detector has anything to say', () => {
    const quiet = makeCtx({
      fenBefore: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
      fenAfter: '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1',
      san: 'e4', uci: 'e2e4', ply: 41, mover: 'white',
      evalBefore: best('e2e4'), classification: 'good',
    });
    const registry = new DetectorRegistry().registerAll([
      new HangingPieceDetector(),
      new DevelopmentDetector(),
    ]);
    assert.equal(new ExplanationEngine(registry).explainMove(quiet), null);
  });
});
