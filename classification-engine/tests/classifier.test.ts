import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MoveClassifier, defaultRules } from '../src/classifier';
import { DEFAULT_CONFIG } from '../src/config';
import { buildContext, materialOf } from '../src/context';
import { offeredMaterial, parseBoard } from '../src/board';
import { winProbability } from '../src/win-probability';
import { ClassificationRule } from '../src/rule';
import { analysis, NO_SAC, QUEEN_SAC } from './helpers';

const classifier = new MoveClassifier();
const label = (a = analysis()) => classifier.classify(a).classification;

describe('win probability model', () => {
  it('is 50% at a dead-level position and rises with the score', () => {
    const cfg = DEFAULT_CONFIG.winProbability;
    assert.equal(Math.round(winProbability(0, null, cfg)), 50);
    assert.ok(winProbability(300, null, cfg) > winProbability(100, null, cfg));
  });

  it('treats a forced mate as won, whichever way it points', () => {
    const cfg = DEFAULT_CONFIG.winProbability;
    assert.equal(winProbability(0, 3, cfg), 100);
    assert.equal(winProbability(0, -3, cfg), 0);
  });
});

describe('material counting', () => {
  it('reads both sides off a FEN', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    assert.equal(materialOf(start, 'white'), materialOf(start, 'black'));
  });

  it('a real sacrifice costs NOTHING until it is accepted', () => {
    // This is why material-diffing cannot detect one, and why offeredMaterial exists.
    assert.equal(materialOf(QUEEN_SAC.before, 'white'), materialOf(QUEEN_SAC.after, 'white'));
  });

  it('sees the material a sacrifice puts on offer', () => {
    // 16.Qb8+ lets a 300cp knight take a 900cp queen.
    assert.equal(offeredMaterial(parseBoard(QUEEN_SAC.after), 'white'), 600);
    assert.equal(offeredMaterial(parseBoard(NO_SAC.after), 'white'), 0);
  });
});

describe('precedence — the label that teaches most wins', () => {
  it('Book beats everything, even a technically weak move', () => {
    assert.equal(label(analysis({
      opening: { isBook: true, name: 'Ruy López' },
      playedMove: 'a2a3', bestMove: 'g1f3', evalAfter: -300, bestEval: 20, centipawnLoss: 320,
    })), 'Book');
  });

  it('Forced outranks any quality verdict', () => {
    assert.equal(label(analysis({
      legalMoves: ['e1e2'], playedMove: 'e1e2', bestMove: 'e1e2', evalAfter: -900, bestEval: -900,
    })), 'Forced');
  });

  it('a plain top choice is Best', () => {
    assert.equal(label(), 'Best');
  });
});

describe('quality bands', () => {
  const drop = (evalAfter: number) => analysis({
    playedMove: 'a2a3', bestMove: 'e2e4', evalAfter, bestEval: 20,
  });

  it('grades from Excellent down to Blunder as the loss grows', () => {
    assert.equal(label(drop(10)), 'Excellent');    // ~1 win% lost
    assert.equal(label(drop(-55)), 'Inaccuracy');   // ~7
    assert.equal(label(drop(-160)), 'Mistake');     // ~16
    assert.equal(label(drop(-900)), 'Blunder');     // ~48
  });

  it('always produces a verdict, never undefined', () => {
    for (const e of [500, 0, -50, -5000]) {
      assert.ok(classifier.classify(drop(e)).classification);
    }
  });
});

describe('Miss', () => {
  it('fires when a forced mate is let go', () => {
    const r = classifier.classify(analysis({
      playedMove: 'a2a3', bestMove: 'd1h5', mateBefore: 2, mateAfter: null,
      evalAfter: 150, bestEval: 2000,
    }));
    assert.equal(r.classification, 'Miss');
    assert.equal(r.metadata.missedMate, true);
  });

  it('fires when a winning position is thrown away', () => {
    assert.equal(label(analysis({
      playedMove: 'a2a3', bestMove: 'd1d8', evalBefore: 800, bestEval: 800, evalAfter: 0,
    })), 'Miss');
  });

  it('stays quiet when the player was never winning', () => {
    assert.notEqual(label(analysis({
      playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 30, evalAfter: -200,
    })), 'Miss');
  });
});

describe('Brilliant', () => {
  const sac = (over = {}) => analysis({
    fenBefore: QUEEN_SAC.before, fenAfter: QUEEN_SAC.after,
    playedMove: QUEEN_SAC.uci, bestMove: QUEEN_SAC.uci,
    evalBefore: 300, bestEval: 300, evalAfter: 300,
    depth: 20, ...over,
  });

  it('rewards a sound sacrifice past the opening', () => {
    const r = classifier.classify(sac());
    assert.equal(r.classification, 'Brilliant');
    assert.equal(r.metadata.offeredCp, 600);
    assert.ok(r.confidence > 0.7);
  });

  it('refuses when the sacrifice loses — that is a blunder with style', () => {
    assert.notEqual(classifier.classify(sac({ evalAfter: -800 })).classification, 'Brilliant');
  });

  it('refuses on a shallow search it cannot verify', () => {
    assert.notEqual(classifier.classify(sac({ depth: 6 })).classification, 'Brilliant');
  });

  it('refuses a quiet move, where nothing is on offer', () => {
    assert.notEqual(classifier.classify(sac({
      fenBefore: NO_SAC.before, fenAfter: NO_SAC.after, playedMove: NO_SAC.uci, bestMove: NO_SAC.uci,
    })).classification, 'Brilliant');
  });
});

describe('Great', () => {
  const only = (gap: number) => analysis({
    alternatives: [
      { move: 'e2e4', scoreCp: 50, mateIn: null },
      { move: 'd2d4', scoreCp: 50 - gap, mateIn: null },
    ],
    bestEval: 50, evalAfter: 50,
  });

  it('fires when the alternatives were far worse', () => {
    assert.equal(label(only(900)), 'Great');
  });

  it('declines when a second good option existed', () => {
    assert.equal(label(only(10)), 'Best');
  });

  it('declines rather than guessing when MultiPV is absent', () => {
    assert.equal(label(analysis({ alternatives: undefined })), 'Best');
  });
});

describe('confidence', () => {
  it('is reduced when the search was shallow, and says so', () => {
    const deep = classifier.classify(analysis({ depth: 20 }));
    const shallow = classifier.classify(analysis({ depth: 4 }));
    assert.ok(shallow.confidence < deep.confidence);
    assert.ok(shallow.reasons.some((r) => /shallow/i.test(r)));
  });

  it('is lower for a move sitting on a band edge', () => {
    const edge = classifier.classify(analysis({
      playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 0,
      evalAfter: -Math.round(DEFAULT_CONFIG.quality.good * 5.5),
    }));
    const middle = classifier.classify(analysis({
      playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 0, evalAfter: -1200,
    }));
    assert.ok(edge.confidence < middle.confidence);
  });
});

describe('configurability', () => {
  it('honours overridden bands without any code change', () => {
    const strict = new MoveClassifier({ quality: { excellent: 0.1, good: 0.2, inaccuracy: 0.3, mistake: 0.4 } });
    const a = analysis({ playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 20, evalAfter: 0 });
    assert.equal(classifier.classify(a).classification, 'Excellent');
    assert.equal(strict.classify(a).classification, 'Blunder');
  });

  it('leaves untouched sections at their defaults', () => {
    const c = new MoveClassifier({ great: { minDepth: 30 } });
    assert.equal(c.classify(analysis()).classification, 'Best');
  });
});

describe('extensibility and safety', () => {
  it('accepts a custom rule that outranks the built-ins', () => {
    const always: ClassificationRule = {
      id: 'always-brilliant', priority: 999,
      evaluate: () => ({ classification: 'Brilliant', confidence: 1, reasons: ['custom'] }),
    };
    const c = new MoveClassifier({}, [always, ...defaultRules()]);
    assert.equal(c.classify(analysis()).classification, 'Brilliant');
  });

  it('survives a rule that throws', () => {
    const broken: ClassificationRule = {
      id: 'broken', priority: 999,
      evaluate: () => { throw new Error('boom'); },
    };
    const c = new MoveClassifier({}, [broken, ...defaultRules()]);
    assert.equal(c.classify(analysis()).classification, 'Best');
  });

  it('reports which rule decided, for traceability', () => {
    assert.equal(classifier.classify(analysis()).metadata.ruleId, 'best');
  });
});

describe('perspective', () => {
  it('measures loss from the mover, so a black blunder is a blunder', () => {
    // White-POV eval RISES to +900, which is catastrophic for black.
    assert.equal(label(analysis({
      mover: 'black', playedMove: 'a7a6', bestMove: 'g8f6',
      evalBefore: 0, bestEval: 0, evalAfter: 900,
    })), 'Blunder');
  });

  it('does not call the same swing a blunder for white', () => {
    assert.equal(label(analysis({
      mover: 'white', playedMove: 'a2a3', bestMove: 'g1f3',
      evalBefore: 0, bestEval: 0, evalAfter: 900,
    })), 'Excellent');
  });
});

describe('classifyGame', () => {
  it('labels every move of a game', () => {
    const out = classifier.classifyGame([analysis(), analysis({ mover: 'black' })]);
    assert.equal(out.length, 2);
    assert.ok(out.every((m) => typeof m.classification === 'string'));
  });
});

describe('context', () => {
  it('derives the ply from the FEN', () => {
    const ctx = buildContext(analysis({
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 5',
    }), DEFAULT_CONFIG);
    assert.equal(ctx.ply, 10);
  });
});
