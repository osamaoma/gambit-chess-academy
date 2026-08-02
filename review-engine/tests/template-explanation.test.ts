/**
 * The model-free explanation writer.
 *
 * Two things are under test: that it says the RIGHT thing for each kind of
 * finding, and that it obeys the house style — because a fallback that quietly
 * mentions "centipawns" or runs to a paragraph is worse than no fallback.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { MoveAnalysis } from '@gambit/classification-engine';
import { TemplateExplanationGenerator } from '../src/explanation/template-explanation-generator';
import { ReviewPipeline } from '../src/review-pipeline';
import type { ExplanationInput, Motif, MoveComparison, Theme } from '../src/types';

const writer = new TemplateExplanationGenerator();

const comparison = (over: Partial<MoveComparison> = {}): MoveComparison => ({
  played: 'a2a3', best: 'g1f3', isSameMove: false, movesSamePiece: false,
  sharesDestination: false, bestCaptures: false, bestGivesCheck: false,
  playedPiece: 'pawn', bestPiece: 'knight', ...over,
});

const input = (over: Partial<ExplanationInput> = {}): ExplanationInput => ({
  input: { analysis: {} as MoveAnalysis, boards: {} as never },
  context: { phase: 'middlegame' } as never,
  classification: { classification: 'Inaccuracy', confidence: 0.8, reasons: [], metadata: {} },
  comparison: comparison(),
  themes: [], motifs: [], priorities: [],
  ...over,
});

const say = async (over: Partial<ExplanationInput> = {}): Promise<string> =>
  (await writer.generate(input(over))).summary;

describe('what it says', () => {
  it('leads with a tactic the player actually played', async () => {
    const motifs: Motif[] = [{ id: 'fork', label: 'Fork', confidence: 0.9, source: 'played' }];
    assert.match(await say({ motifs }), /attacks two pieces at once/);
  });

  it('describes a tactic that was missed, without claiming it was played', async () => {
    const motifs: Motif[] = [{ id: 'pin', label: 'Pin', confidence: 0.9, source: 'best' }];
    const text = await say({ motifs });
    assert.match(text, /stronger idea/);
    assert.match(text, /pins a piece/);
    assert.ok(!/your move/i.test(text), 'must not attribute the missed tactic to the move played');
  });

  it('names the square when the better move wins material', async () => {
    assert.match(await say({ comparison: comparison({ best: 'e4d5', bestCaptures: true }) }), /d5/);
  });

  it('says "right piece, wrong square" when that is what happened', async () => {
    const cmp = comparison({ played: 'g1h3', best: 'g1f3', movesSamePiece: true });
    const text = await say({ comparison: cmp });
    assert.match(text, /Right piece, wrong square/);
    assert.match(text, /f3/);
  });

  it('falls back to the position\'s plan when it has nothing sharper', async () => {
    const text = await say({ priorities: [{ id: 'dev', statement: 'finish development', weight: 1 }] });
    assert.match(text, /finish development/);
  });

  it('explains what a best move achieved, using the theme', async () => {
    const themes: Theme[] = [{ id: 'king-safety', label: 'King safety', weight: 1 }];
    const text = await say({ comparison: comparison({ isSameMove: true }), themes });
    assert.match(text, /king/i);
  });

  it('always says something, even with no findings at all', async () => {
    const text = await say({ comparison: null, themes: [], motifs: [], priorities: [] });
    assert.ok(text.length > 10, `expected a sentence, got "${text}"`);
  });
});

describe('house style', () => {
  const cases: Partial<ExplanationInput>[] = [
    { motifs: [{ id: 'fork', label: 'Fork', confidence: 1, source: 'played' }] },
    { motifs: [{ id: 'back-rank', label: 'Back rank', confidence: 1, source: 'best' }] },
    { comparison: comparison({ bestCaptures: true }) },
    { comparison: comparison({ bestGivesCheck: true }) },
    { comparison: comparison({ movesSamePiece: true }) },
    { comparison: comparison({ isSameMove: true }), themes: [{ id: 'development', label: 'Development', weight: 1 }] },
    { comparison: null, priorities: [{ id: 'p', statement: 'trade into the endgame', weight: 1 }] },
    { comparison: null },
  ];

  it('never mentions engines, evaluations or centipawns', async () => {
    const banned = /\b(engine|stockfish|centipawns?|eval|evaluation)\b/i;
    for (const c of cases) {
      const text = await say(c);
      assert.ok(!banned.test(text), `forbidden term in: "${text}"`);
    }
  });

  it('never names the classification label', async () => {
    for (const c of cases) {
      const text = await say(c);
      assert.ok(!/\b(inaccuracy|blunder|mistake)\b/i.test(text), `verdict leaked into: "${text}"`);
    }
  });

  it('stays under the word limit', async () => {
    for (const c of cases) {
      assert.ok((await say(c)).split(/\s+/).length <= 80);
    }
  });

  it('trims an over-long line at a sentence boundary', async () => {
    const tiny = new TemplateExplanationGenerator({ maxWords: 6 });
    const out = await tiny.generate(input({ comparison: comparison({ movesSamePiece: true }) }));
    assert.ok(out.summary.split(/\s+/).length <= 6);
  });
});

describe('pipeline wiring', () => {
  const move: MoveAnalysis = {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1',
    playedMove: 'a2a3', bestMove: 'g1f3',
    evalBefore: 20, evalAfter: -10, bestEval: 20, centipawnLoss: 30,
    mateBefore: null, mateAfter: null, principalVariation: ['g1f3'],
    depth: 18, legalMoves: ['a2a3', 'g1f3', 'e2e4'],
    phase: 'opening', opening: null, mover: 'white',
  };

  it('a pipeline built with no arguments now explains its moves', async () => {
    const reviewed = await new ReviewPipeline().reviewMove(move);
    assert.ok(reviewed.explanation.summary.length > 0, 'default pipeline produced no explanation');
    assert.equal(reviewed.explanation.source, 'fallback');
  });

  it('still lets explanations be switched off explicitly', async () => {
    const reviewed = await new ReviewPipeline({ explanations: null }).reviewMove(move);
    assert.equal(reviewed.explanation.summary, '');
  });

  it('varies its wording across a game rather than repeating one line', async () => {
    const moves = [move, { ...move, playedMove: 'b2b3' }, { ...move, playedMove: 'h2h3' }];
    const reviewed = await new ReviewPipeline().reviewGame(moves);
    assert.equal(reviewed.length, 3);
    assert.ok(reviewed.every((r) => r.explanation.summary.length > 0));
  });
});
