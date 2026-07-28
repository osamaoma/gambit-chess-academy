import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { MoveAnalysis } from '@gambit/classification-engine';
import { ReviewPipeline } from '../src/review-pipeline';
import { DefaultPositionContextDetector } from '../src/position-context-detector';
import { DefaultBestMoveComparator } from '../src/best-move-comparator';
import { DefaultArrowGenerator } from '../src/arrow-generator';
import { DefaultHighlightGenerator } from '../src/highlight-generator';
import type { ExplanationGenerator, ExplanationInput, VisualInput } from '../src/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_A3 = 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1';

const move = (over: Partial<MoveAnalysis> = {}): MoveAnalysis => ({
  fenBefore: START, fenAfter: AFTER_A3,
  playedMove: 'a2a3', bestMove: 'g1f3',
  evalBefore: 20, evalAfter: -10, bestEval: 20, centipawnLoss: 30,
  mateBefore: null, mateAfter: null, principalVariation: ['g1f3'],
  depth: 18, legalMoves: ['a2a3', 'g1f3', 'e2e4'],
  phase: 'opening', opening: null, mover: 'white',
  ...over,
});

/** A writer that records what it was given and echoes a fixed note. */
class SpyWriter implements ExplanationGenerator {
  seen: ExplanationInput[] = [];
  constructor(private readonly note = 'Develop a piece instead.') {}
  async generate(input: ExplanationInput) {
    this.seen.push(input);
    return { summary: `${this.note} (${this.seen.length})`, source: 'model' as const };
  }
}

describe('PositionContextDetector', () => {
  const d = new DefaultPositionContextDetector();

  it('reads phase, material and ply from the position alone', () => {
    const c = d.detect(START, 'white');
    assert.equal(c.phase, 'opening');
    assert.equal(c.material.white, c.material.black);
    assert.equal(c.material.moverNet, 0);
    assert.equal(c.ply, 1);
    assert.deepEqual(c.kingsOnHome, { white: true, black: true });
  });

  it('calls a bare-board position an endgame regardless of move number', () => {
    const c = d.detect('4k3/8/8/8/8/8/4P3/4K3 w - - 0 40', 'white');
    assert.equal(c.phase, 'endgame');
  });

  it('finds open and half-open files', () => {
    const c = d.detect('4k3/pp4pp/8/8/8/8/PP4PP/4K3 w - - 0 20', 'white');
    assert.ok(c.openFiles.includes('d'));
    assert.ok(!c.openFiles.includes('a'));
  });
});

describe('BestMoveComparator', () => {
  const c = new DefaultBestMoveComparator();

  it('spots the same move', () => {
    assert.equal(c.compare(START, 'e2e4', 'e2e4')!.isSameMove, true);
  });

  it('spots "right piece, wrong square"', () => {
    const r = c.compare(START, 'g1f3', 'g1h3')!;
    assert.equal(r.movesSamePiece, true);
    assert.equal(r.isSameMove, false);
    assert.equal(r.bestPiece, 'knight');
  });

  it('reports when the better move captures', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    assert.equal(c.compare(fen, 'a2a3', 'e4d5')!.bestCaptures, true);
  });

  it('returns null on an unreadable position instead of throwing', () => {
    assert.equal(c.compare('nonsense', 'e2e4', 'e2e4'), null);
  });
});

describe('ArrowGenerator', () => {
  const base = (over: Partial<VisualInput>): VisualInput => ({
    input: { analysis: move(), boards: {} as never },
    context: {} as never,
    classification: {} as never,
    comparison: new DefaultBestMoveComparator().compare(START, 'a2a3', 'g1f3'),
    themes: [], motifs: [], priorities: [],
    explanation: { summary: '' },
    ...over,
  });

  it('draws the better move, because it is not on the board', () => {
    const arrows = new DefaultArrowGenerator().generate(base({}));
    assert.deepEqual(arrows.map((a) => `${a.from}${a.to}:${a.color}`), ['g1f3:best']);
    assert.ok(arrows[0]!.reason.length > 0);
  });

  it('never retraces the move that was just played', () => {
    const arrows = new DefaultArrowGenerator().generate(base({
      motifs: [{ id: 'fork', label: 'Fork', confidence: 1, source: 'played', squares: ['a2', 'a3'] }],
    }));
    assert.equal(arrows.some((a) => a.from === 'a2' && a.to === 'a3'), false);
  });

  it('respects the arrow cap', () => {
    const gen = new DefaultArrowGenerator(undefined, {
      maxArrows: 1, showBestMove: true, showPlayedMotifs: true, showMissedMotifs: true,
    });
    const arrows = gen.generate(base({
      motifs: [{ id: 'fork', label: 'Fork', confidence: 1, source: 'played', squares: ['d4', 'f5', 'b5'] }],
    }));
    assert.equal(arrows.length, 1);
  });
});

describe('HighlightGenerator', () => {
  it('gives every square a stated reason', () => {
    const highlights = new DefaultHighlightGenerator().generate({
      input: { analysis: move(), boards: {} as never },
      context: {} as never, classification: {} as never,
      comparison: new DefaultBestMoveComparator().compare(START, 'a2a3', 'g1f3'),
      themes: [{ id: 'development', label: 'Development', weight: 1, squares: ['f3'] }],
      motifs: [], priorities: [], explanation: { summary: '' },
    });
    assert.ok(highlights.length > 0);
    assert.ok(highlights.every((h) => h.reason.length > 0));
  });

  it('lets the first rule claim a square, so tactics beat themes', () => {
    const highlights = new DefaultHighlightGenerator().generate({
      input: { analysis: move(), boards: {} as never },
      context: {} as never, classification: {} as never, comparison: null,
      themes: [{ id: 'development', label: 'Development', weight: 1, squares: ['e5'] }],
      motifs: [{ id: 'fork', label: 'Fork', confidence: 1, source: 'played', squares: ['c4', 'e5'] }],
      priorities: [], explanation: { summary: '' },
    });
    const e5 = highlights.find((h) => h.square === 'e5')!;
    assert.equal(e5.color, 'threat');
  });
});

describe('ReviewPipeline', () => {
  it('produces a complete review of one move', async () => {
    const writer = new SpyWriter();
    const reviewed = await new ReviewPipeline({ explanations: writer }).reviewMove(move());

    assert.equal(reviewed.mover, 'white');
    assert.ok(reviewed.classification.classification);
    assert.equal(reviewed.context.phase, 'opening');
    assert.equal(reviewed.comparison!.isSameMove, false);
    assert.ok(reviewed.explanation.summary.startsWith('Develop a piece instead.'));
    assert.ok(reviewed.arrows.length > 0);
  });

  it('hands the writer only settled conclusions', async () => {
    const writer = new SpyWriter();
    await new ReviewPipeline({ explanations: writer }).reviewMove(move());
    const seen = writer.seen[0]!;
    assert.ok(seen.classification.classification);
    assert.ok(Array.isArray(seen.themes));
    assert.ok(Array.isArray(seen.priorities));
  });

  it('names what the position is asking for, and surfaces it', async () => {
    const reviewed = await new ReviewPipeline().reviewMove(move());
    // Move 1 with an uncastled king and pieces at home: both plans should fire.
    const ids = reviewed.priorities.map((p) => p.id);
    assert.ok(ids.includes('king-safety'), `expected a king plan, got ${ids.join(',')}`);
    assert.ok(ids.includes('finish-development'));
    assert.ok(reviewed.priorities.every((p) => p.statement.length > 0));
    // Ranked, and capped so a review never lists six competing plans.
    assert.ok(reviewed.priorities.length <= 3);
    assert.ok(reviewed.priorities[0]!.weight >= reviewed.priorities[1]!.weight);
  });

  it('threads earlier notes through a game so wording can vary', async () => {
    const writer = new SpyWriter();
    await new ReviewPipeline({ explanations: writer }).reviewGame([move(), move(), move()]);
    assert.equal(writer.seen.length, 3);
    assert.equal(writer.seen[0]!.recentSummaries!.length, 0);
    assert.equal(writer.seen[2]!.recentSummaries!.length, 2);
  });

  it('still returns a review when the writer fails', async () => {
    const failing: ExplanationGenerator = { generate: async () => { throw new Error('model down'); } };
    const errors: number[] = [];
    const reviewed = await new ReviewPipeline(
      { explanations: failing },
      { onExplanationError: (_e, ply) => errors.push(ply) },
    ).reviewMove(move());

    assert.equal(reviewed.explanation.summary, '');
    assert.ok(reviewed.classification.classification);  // the analysis survives
    assert.equal(errors.length, 1);
  });

  it('works with no writer configured at all', async () => {
    const reviewed = await new ReviewPipeline().reviewMove(move());
    assert.equal(reviewed.explanation.summary, '');
  });

  it('lets any module be swapped out', async () => {
    const reviewed = await new ReviewPipeline({
      themes: { detect: () => [{ id: 'custom', label: 'Custom', weight: 1 }] },
    }).reviewMove(move());
    assert.deepEqual(reviewed.themes.map((t) => t.id), ['custom']);
  });
});
