/**
 * The six configurable quality rules: Best, Excellent, Good, Inaccuracy,
 * Mistake, Blunder.
 *
 * Three things are under test, and they are kept apart on purpose:
 *  - each SIGNAL on its own (centipawn loss, evaluation swing, win% drop),
 *    isolated by pinning the combining policy to that signal;
 *  - the COMBINING policy, where signals disagree;
 *  - PHASE scaling, which stretches every threshold.
 *
 * No test hardcodes a threshold. Each reads the value it is probing from the
 * config, so retuning the defaults cannot silently invalidate these.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MoveClassifier } from '../src/classifier';
import { DEFAULT_CONFIG, resolveConfig, thresholdsFor, type CombinePolicy } from '../src/config';
import { buildContext } from '../src/context';
import { qualityBandOf, BAND_ORDER } from '../src/rules/quality-band';
import type { GamePhase, MoveAnalysis } from '../src/types';

const Q = DEFAULT_CONFIG.quality;

/**
 * A move that gives up exactly `cp` centipawns from a level position.
 * `evalSwing` and `centipawnLoss` are equal here; win% follows from the curve.
 */
function move(cp: number, phase: GamePhase = 'middlegame', over: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    playedMove: 'a2a3', bestMove: 'e2e4',
    evalBefore: 0, evalAfter: -cp, bestEval: 0, centipawnLoss: cp,
    mateBefore: null, mateAfter: null, principalVariation: [],
    depth: 18, legalMoves: ['a2a3', 'e2e4'], phase, opening: null, mover: 'white',
    ...over,
  };
}

const bandOf = (a: MoveAnalysis, policy: CombinePolicy = 'worst') => {
  const config = resolveConfig({ quality: { combine: policy } });
  return qualityBandOf(buildContext(a, config), config).band;
};

/* ────────────────────────────── per-signal bands ───────────────────────────── */

describe('centipawn loss drives the bands', () => {
  const band = (cp: number, phase: GamePhase = 'middlegame') => bandOf(move(cp, phase), 'centipawnLoss');

  it('places a move in the band its loss falls in', () => {
    // Read the ceilings from config, then probe just inside each.
    assert.equal(band(Q.excellent.centipawnLoss), 'Excellent');
    assert.equal(band(Q.good.centipawnLoss), 'Good');
    assert.equal(band(Q.inaccuracy.centipawnLoss), 'Inaccuracy');
    assert.equal(band(Q.mistake.centipawnLoss), 'Mistake');
    assert.equal(band(Q.mistake.centipawnLoss + 1), 'Blunder');
  });

  it('treats a threshold as inclusive, and one centipawn more as the next band', () => {
    assert.equal(band(Q.good.centipawnLoss), 'Good');
    assert.equal(band(Q.good.centipawnLoss + 1), 'Inaccuracy');
  });

  it('gives a move that costs nothing the best possible band', () => {
    assert.equal(band(0), 'Excellent');
  });

  it('never rewards a bigger loss with a better band', () => {
    let previous = -1;
    for (const cp of [0, 20, 60, 140, 300, 600, 5000]) {
      const index = BAND_ORDER.indexOf(band(cp) as never);
      assert.ok(index >= previous, `${cp}cp graded better than a smaller loss`);
      previous = index;
    }
  });
});

describe('evaluation swing drives the bands', () => {
  it('is measured against where the position stood, not against best play', () => {
    // The engine's own best move was already a concession, so almost nothing
    // was "lost" against it — yet the position collapsed. Centipawn loss is
    // blind to this; swing is not.
    const forcedConcession = move(0, 'middlegame', {
      evalBefore: 300, bestEval: -100, evalAfter: -120, centipawnLoss: 20,
    });
    const ctx = buildContext(forcedConcession, DEFAULT_CONFIG);
    assert.equal(ctx.centipawnLoss, 20, 'barely worse than the best available move');
    assert.equal(ctx.evalSwing, 420, 'but the position fell apart');
    assert.equal(bandOf(forcedConcession, 'evalSwing'), 'Mistake');
    assert.equal(bandOf(forcedConcession, 'centipawnLoss'), 'Excellent');
  });

  it('is never negative when the move improves the position', () => {
    const improving = move(0, 'middlegame', { evalBefore: 0, bestEval: 0, evalAfter: 500 });
    assert.equal(buildContext(improving, DEFAULT_CONFIG).evalSwing, 0);
  });
});

describe('win% drop drives the bands', () => {
  it('is the strictest signal near equality, where small swings matter most', () => {
    assert.equal(bandOf(move(60), 'winPctDrop'), 'Inaccuracy');
    assert.equal(bandOf(move(60), 'centipawnLoss'), 'Good');
  });

  it('saturates when the game is already decided — which is why cp exists', () => {
    // 600 centipawns thrown away, but from +1500 it barely moves the odds.
    const winning = move(600, 'middlegame', { evalBefore: 1500, bestEval: 1500, evalAfter: 900 });
    const byWin = BAND_ORDER.indexOf(bandOf(winning, 'winPctDrop') as never);
    const byCp = BAND_ORDER.indexOf(bandOf(winning, 'centipawnLoss') as never);
    assert.ok(byWin < byCp - 1, 'win% barely registers a 600cp giveaway from +15');
    assert.equal(bandOf(winning, 'centipawnLoss'), 'Blunder', 'centipawns see the truth');
    assert.equal(bandOf(winning, 'worst'), 'Blunder', 'and the default reports it');
  });
});

/* ────────────────────────────── combining policy ───────────────────────────── */

describe('combining policy', () => {
  const disagreeing = move(600, 'middlegame', { evalBefore: 1500, bestEval: 1500, evalAfter: 900 });

  it("'worst' reports the harshest signal, so real errors are never hidden", () => {
    assert.equal(bandOf(disagreeing, 'worst'), 'Blunder');
  });

  it('a single-signal policy uses only that signal', () => {
    assert.equal(bandOf(disagreeing, 'winPctDrop'), 'Good');
    assert.equal(bandOf(disagreeing, 'centipawnLoss'), 'Blunder');
  });

  it('records which signal decided, so a surprising label can be traced', () => {
    const config = resolveConfig();
    const detail = qualityBandOf(buildContext(disagreeing, config), config);
    assert.equal(detail.decidedBy, 'centipawnLoss');
    assert.equal(detail.perSignal.winPctDrop, 'Good');
    assert.equal(detail.perSignal.centipawnLoss, 'Blunder');
  });

  it('surfaces the deciding signal in the verdict metadata', () => {
    const r = new MoveClassifier().classify(disagreeing);
    assert.equal(r.classification, 'Blunder');
    assert.equal(r.metadata.decidedBy, 'centipawnLoss');
    assert.ok(r.metadata.perSignalBands, 'per-signal breakdown is reported');
  });
});

/* ────────────────────────────── phase scaling ──────────────────────────────── */

describe('game phase scales every threshold', () => {
  it('is more forgiving in the opening than in the endgame', () => {
    const opening = BAND_ORDER.indexOf(bandOf(move(200, 'opening')) as never);
    const middle = BAND_ORDER.indexOf(bandOf(move(200, 'middlegame')) as never);
    const endgame = BAND_ORDER.indexOf(bandOf(move(200, 'endgame')) as never);
    assert.ok(opening <= middle, 'the opening must not be harsher than the middlegame');
    assert.ok(endgame >= middle, 'the endgame must not be softer than the middlegame');
    assert.ok(endgame > opening, 'the same loss should be graded differently across a game');
  });

  it('scales a threshold by exactly the configured multiplier', () => {
    for (const phase of ['opening', 'middlegame', 'endgame'] as const) {
      const scaled = thresholdsFor(Q.good, phase, Q);
      assert.equal(scaled.centipawnLoss, Q.good.centipawnLoss * Q.phaseMultipliers[phase]);
      assert.equal(scaled.evalSwing, Q.good.evalSwing * Q.phaseMultipliers[phase]);
    }
  });

  it('lets a phase be retuned on its own', () => {
    // Make the opening as strict as the endgame; the same move gets worse.
    const strictOpening = new MoveClassifier({ quality: { phaseMultipliers: { opening: 0.3 } } });
    const lenient = new MoveClassifier();
    const m = move(120, 'opening');
    assert.notEqual(strictOpening.classify(m).classification, lenient.classify(m).classification);
  });
});

/* ────────────────────────────── configurability ────────────────────────────── */

describe('nothing is hardcoded', () => {
  it('retunes every band from the config alone', () => {
    const harsh = new MoveClassifier({
      quality: {
        excellent: { winPctDrop: 0.1, centipawnLoss: 1, evalSwing: 1 },
        good: { winPctDrop: 0.2, centipawnLoss: 2, evalSwing: 2 },
        inaccuracy: { winPctDrop: 0.3, centipawnLoss: 3, evalSwing: 3 },
        mistake: { winPctDrop: 0.4, centipawnLoss: 4, evalSwing: 4 },
      },
    });
    const m = move(30);
    assert.equal(new MoveClassifier().classify(m).classification, 'Good');
    assert.equal(harsh.classify(m).classification, 'Blunder');
  });

  it('keeps untouched sections at their defaults when one is overridden', () => {
    const config = resolveConfig({ quality: { good: { winPctDrop: 99, centipawnLoss: 99, evalSwing: 99 } } });
    assert.equal(config.quality.excellent.centipawnLoss, Q.excellent.centipawnLoss);
    assert.equal(config.quality.mistake.centipawnLoss, Q.mistake.centipawnLoss);
    assert.equal(config.quality.combine, Q.combine);
  });

  it('always answers, whatever the thresholds are set to', () => {
    const absurd = new MoveClassifier({
      quality: {
        excellent: { winPctDrop: 0, centipawnLoss: 0, evalSwing: 0 },
        good: { winPctDrop: 0, centipawnLoss: 0, evalSwing: 0 },
        inaccuracy: { winPctDrop: 0, centipawnLoss: 0, evalSwing: 0 },
        mistake: { winPctDrop: 0, centipawnLoss: 0, evalSwing: 0 },
      },
    });
    for (const cp of [0, 1, 50, 9999]) {
      assert.ok(absurd.classify(move(cp)).classification, `no verdict at ${cp}cp`);
    }
  });
});

/* ────────────────────────────── Best ───────────────────────────────────────── */

describe('Best', () => {
  it('fires on the engine move regardless of the numbers', () => {
    const played = move(0, 'middlegame', { playedMove: 'e2e4', bestMove: 'e2e4' });
    assert.equal(new MoveClassifier().classify(played).classification, 'Best');
  });

  it('does not fire on a different move that costs something, by default', () => {
    assert.notEqual(new MoveClassifier().classify(move(40)).classification, 'Best');
  });

  it('fires within a widened tolerance, with no code change', () => {
    const lenient = new MoveClassifier({
      quality: { best: { winPctDrop: 5, centipawnLoss: 50, evalSwing: 50 } },
    });
    assert.equal(lenient.classify(move(40)).classification, 'Best');
  });

  it('outranks the quality bands when both apply', () => {
    const r = new MoveClassifier().classify(move(0, 'middlegame', { playedMove: 'e2e4', bestMove: 'e2e4' }));
    assert.equal(r.classification, 'Best');
    assert.ok((r.metadata.matchedRules as string[]).includes('excellent'), 'Excellent also matched');
  });
});
