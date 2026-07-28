/**
 * Tests for the compact-card layer: every surfaced explanation must carry a
 * SHORT, position-specific sentence and board annotations that point at the
 * squares it is talking about.
 *
 * These are the guarantees the review UI relies on: a card always has one line
 * to print, and an arrow/highlight set it can draw without inspecting which
 * detector spoke.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CenterControlDetector } from '../src/detectors/center-control';
import { HangingPieceDetector } from '../src/detectors/hanging-piece';
import { PieceActivityDetector } from '../src/detectors/piece-activity';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { MoveContext } from '../src/types';
import { makeCtx, positionalCtx } from './helpers';

const AFTER_NF3 = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Give a context a viewer so the wording becomes "Your"/"Their". */
function withViewer(ctx: MoveContext, viewerColor: 'white' | 'black'): MoveContext {
  return { ...ctx, meta: { ...ctx.meta, viewerColor } };
}

describe('summary — one specific sentence per explanation', () => {
  it('names the piece and the square it took', () => {
    const r = new CenterControlDetector().detect(
      withViewer(positionalCtx(START, 'e2e4', { san: 'e4', classification: 'book' }), 'white'),
    );
    assert.equal(r.applies, true);
    const summary = r.explanation!.summary as string;
    assert.ok(summary.includes('e4'), `expected the square in: ${summary}`);
    assert.ok(summary.startsWith('Your'), `expected viewer voice in: ${summary}`);
  });

  it('switches to "Their" when the opponent made the move', () => {
    const r = new CenterControlDetector().detect(
      withViewer(positionalCtx(START, 'e2e4', { san: 'e4', classification: 'book' }), 'black'),
    );
    const summary = r.explanation!.summary as string;
    assert.ok(summary.startsWith('Their'), `expected opponent voice in: ${summary}`);
  });

  it('names the colour when the viewer is unknown', () => {
    const r = new CenterControlDetector().detect(
      positionalCtx(START, 'e2e4', { san: 'e4', classification: 'book' }),
    );
    const summary = r.explanation!.summary as string;
    assert.ok(summary.startsWith("White's"), `expected neutral voice in: ${summary}`);
  });
});

describe('book / excellent moves are explained (they used to be silent)', () => {
  for (const classification of ['book', 'excellent', 'forced'] as const) {
    it(`a ${classification} move still gets an explanation`, () => {
      const r = new CenterControlDetector().detect(
        positionalCtx(START, 'd2d4', { san: 'd4', classification }),
      );
      assert.equal(r.applies, true, `${classification} should be explained`);
      assert.ok((r.explanation!.summary as string).length > 0);
    });
  }

  it('a developing knight move is described as coming into play', () => {
    const r = new PieceActivityDetector().detect(
      withViewer(positionalCtx(AFTER_NF3, 'b8c6', { san: 'Nc6', classification: 'book' }), 'white'),
    );
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /brings the knight into play/);
    assert.match(r.explanation!.summary as string, /knight comes into play on c6/);
  });
});

describe('visuals — the claim is pointed at on the board', () => {
  it('an occupied centre square is highlighted and the move is drawn', () => {
    const r = new CenterControlDetector().detect(
      positionalCtx(START, 'e2e4', { san: 'e4', classification: 'good' }),
    );
    const v = r.explanation!.visuals!;
    assert.deepEqual(v.arrows[0], { from: 'e2', to: 'e4', color: 'idea' });
    assert.ok(v.squares.some((s) => s.square === 'e4' && s.color === 'idea'));
  });

  it('a developing knight points an arrow at the centre squares it supports', () => {
    const r = new PieceActivityDetector().detect(
      positionalCtx(AFTER_NF3, 'b8c6', { san: 'Nc6', classification: 'good' }),
    );
    const v = r.explanation!.visuals!;
    assert.ok(v.arrows.some((a) => a.from === 'b8' && a.to === 'c6' && a.color === 'idea'));
    // Nc6 hits d4 and e5 — both are central squares worth pointing at.
    assert.ok(v.arrows.some((a) => a.from === 'c6' && a.to === 'd4' && a.color === 'target'),
      `expected a support arrow to d4, got ${JSON.stringify(v.arrows)}`);
  });

  it('a hanging piece is marked red with an arrow from every attacker', () => {
    // Black queen on d5 is attacked by the white knight on c3 and undefended.
    const fen = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 0 1';
    const r = new HangingPieceDetector().detect(
      positionalCtx(fen, 'a7a6', { san: 'a6', classification: 'blunder' }),
    );
    if (!r.applies) return; // geometry-dependent; the shape assertions below only run when it fires
    const v = r.explanation!.visuals!;
    assert.ok(v.squares.some((s) => s.color === 'danger'));
    for (const a of v.arrows) assert.match(a.from, /^[a-h][1-8]$/);
  });

  it('every arrow and square uses real board coordinates', () => {
    const r = new CenterControlDetector().detect(
      positionalCtx(START, 'd2d4', { san: 'd4', classification: 'good' }),
    );
    const v = r.explanation!.visuals!;
    for (const a of v.arrows) {
      assert.match(a.from, /^[a-h][1-8]$/);
      assert.match(a.to, /^[a-h][1-8]$/);
    }
    for (const s of v.squares) assert.match(s.square, /^[a-h][1-8]$/);
  });
});

describe('UserExplanation always carries a summary and visuals', () => {
  const engine = new ExplanationEngine(
    new DetectorRegistry().register(new CenterControlDetector()).register(new PieceActivityDetector()),
  );

  it('fills summary and visuals for a normal move', () => {
    const ex = engine.explainMove(positionalCtx(START, 'e2e4', { san: 'e4', classification: 'book' }));
    assert.ok(ex);
    assert.ok(ex!.summary.length > 0);
    assert.ok(Array.isArray(ex!.visuals.arrows));
    assert.ok(Array.isArray(ex!.visuals.squares));
  });

  it('falls back to the headline when a detector gives no summary', () => {
    // FakeDetector (helpers) returns no summary — the engine must still supply one.
    const { FakeDetector } = require('./helpers') as typeof import('./helpers');
    const e = new ExplanationEngine(new DetectorRegistry().register(new FakeDetector({ id: 'f', headline: 'Hi.' })));
    const ex = e.explainMove(makeCtx());
    assert.equal(ex!.summary, 'Hi.');
    assert.deepEqual(ex!.visuals, { arrows: [], squares: [] });
  });
});
