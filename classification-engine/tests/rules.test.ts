/**
 * The rule engine contract, and each rule in isolation.
 *
 * Rules are pure functions of (context, config), so every one of these tests
 * builds a context and calls a single rule directly — no engine, no other
 * rules. That is the point of the design: a rule can be wrong in exactly one
 * place, and a test can say so without staging a whole game.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MoveClassifier, defaultRules } from '../src/classifier';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config';
import { buildContext } from '../src/context';
import type { ClassificationRule } from '../src/rule';
import { BaseRule } from '../src/rule';
import type { QualityBandRule } from '../src/rules';
import {
  BestRule, BlunderRule, BookRule, BrilliantRule, ExcellentRule, ForcedRule,
  GoodRule, GreatRule, InaccuracyRule, MissRule, MistakeRule,
} from '../src/rules';
import { analysis, NO_SAC, QUEEN_SAC } from './helpers';
import type { MoveAnalysis } from '../src/types';

const ctxOf = (a: MoveAnalysis) => buildContext(a, DEFAULT_CONFIG);
const cfg = DEFAULT_CONFIG;

/** A move losing roughly `drop` win% — used to aim at a specific band. */
const losing = (evalAfter: number) =>
  analysis({ playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 20, evalAfter });

describe('rule contract', () => {
  it('every default rule exposes applies, priority and classify', () => {
    for (const rule of defaultRules()) {
      assert.equal(typeof rule.id, 'string', `${rule.id} needs an id`);
      assert.equal(typeof rule.applies, 'function', `${rule.id} needs applies()`);
      assert.equal(typeof rule.priority, 'function', `${rule.id} needs priority()`);
      assert.equal(typeof rule.classify, 'function', `${rule.id} needs classify()`);
    }
  });

  it('has one rule per classification, and no duplicate ids', () => {
    const ids = defaultRules().map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
    assert.equal(ids.length, 11, 'one rule for each of the 11 classifications');
  });

  it('applies() is a pure predicate — asking twice changes nothing', () => {
    const ctx = ctxOf(analysis());
    for (const rule of defaultRules()) {
      assert.equal(rule.applies(ctx, cfg), rule.applies(ctx, cfg), `${rule.id} is not pure`);
    }
  });

  it('the band rules together cover every possible move', () => {
    const bands = [new ExcellentRule(), new GoodRule(), new InaccuracyRule(), new MistakeRule(), new BlunderRule()];
    for (const evalAfter of [500, 20, 0, -30, -80, -200, -600, -5000]) {
      const ctx = ctxOf(losing(evalAfter));
      const hits = bands.filter((b) => b.applies(ctx, cfg));
      assert.equal(hits.length, 1, `expected exactly one band at evalAfter=${evalAfter}, got ${hits.map((h) => h.id)}`);
    }
  });
});

describe('engine behaviour', () => {
  it('returns the HIGHEST-priority match, not the first one found', () => {
    // A forced move is also "best" here; Forced (90) must beat Best (50).
    const forced = analysis({ legalMoves: ['e2e4'], playedMove: 'e2e4', bestMove: 'e2e4' });
    const result = new MoveClassifier().classify(forced);
    assert.equal(result.classification, 'Forced');
    assert.ok((result.metadata.matchedRules as string[]).includes('best'), 'best should also have matched');
  });

  it('reports every rule that recognised the move', () => {
    const result = new MoveClassifier().classify(analysis());
    const matched = result.metadata.matchedRules as string[];
    assert.ok(matched.length >= 2, `expected several matches, got ${matched}`);
    assert.equal(matched[0], result.metadata.ruleId, 'the winner leads the list');
  });

  it('honours a context-dependent priority()', () => {
    // Ranks itself above everything only in the endgame.
    class EndgameOverride extends BaseRule {
      readonly id = 'endgame-override';
      protected readonly rank = 0;
      applies(): boolean { return true; }
      override priority(ctx: ReturnType<typeof ctxOf>): number {
        return ctx.analysis.phase === 'endgame' ? 999 : 1;
      }
      classify() { return { classification: 'Great' as const, confidence: 1, reasons: ['endgame'] }; }
    }
    const c = new MoveClassifier({}, [new EndgameOverride(), ...defaultRules()]);
    assert.equal(c.classify(analysis({ phase: 'opening' })).classification, 'Best');
    assert.equal(c.classify(analysis({ phase: 'endgame' })).classification, 'Great');
  });

  it('falls through to the next match when the winner throws', () => {
    const brokenTop: ClassificationRule = {
      id: 'broken-top',
      applies: () => true,
      priority: () => 999,
      classify: () => { throw new Error('boom'); },
    };
    const result = new MoveClassifier({}, [brokenTop, ...defaultRules()]).classify(analysis());
    assert.equal(result.classification, 'Best', 'should fall back to the real winner');
    assert.equal(result.metadata.ruleId, 'best');
  });

  it('ignores a rule whose priority() is not a number', () => {
    const bad: ClassificationRule = {
      id: 'bad-priority',
      applies: () => true,
      priority: () => NaN,
      classify: () => ({ classification: 'Blunder', confidence: 1, reasons: [] }),
    };
    assert.equal(new MoveClassifier({}, [bad, ...defaultRules()]).classify(analysis()).classification, 'Best');
  });

  it('breaks priority ties deterministically', () => {
    const make = (id: string): ClassificationRule => ({
      id, applies: () => true, priority: () => 500,
      classify: () => ({ classification: 'Great', confidence: 1, reasons: [id] }),
    });
    const a = new MoveClassifier({}, [make('zulu'), make('alpha')]).classify(analysis());
    const b = new MoveClassifier({}, [make('alpha'), make('zulu')]).classify(analysis());
    assert.equal(a.metadata.ruleId, 'alpha');
    assert.equal(b.metadata.ruleId, 'alpha', 'registration order must not matter');
  });

  it('answers even when given a rule set that matches nothing', () => {
    const never: ClassificationRule = {
      id: 'never', applies: () => false, priority: () => 1,
      classify: () => ({ classification: 'Best', confidence: 1, reasons: [] }),
    };
    const r = new MoveClassifier({}, [never]).classify(analysis());
    assert.equal(r.metadata.ruleId, null);
    assert.ok(r.confidence < 0.2, 'an unrecognised move must not look confident');
  });

  it('exposes the matches for debugging a surprising label', () => {
    const matches = new MoveClassifier().matchingRules(analysis());
    assert.ok(matches.length > 0);
    for (let i = 1; i < matches.length; i++) {
      assert.ok(matches[i - 1]!.priority >= matches[i]!.priority, 'sorted strongest first');
    }
  });
});

describe('rules in isolation', () => {
  it('BookRule fires only on theory', () => {
    const rule: ClassificationRule = new BookRule();
    assert.equal(rule.applies(ctxOf(analysis({ opening: { isBook: true } })), cfg), true);
    assert.equal(rule.applies(ctxOf(analysis({ opening: { isBook: false } })), cfg), false);
    assert.equal(rule.applies(ctxOf(analysis({ opening: null })), cfg), false);
  });

  it('ForcedRule fires only on a single legal move', () => {
    const rule: ClassificationRule = new ForcedRule();
    assert.equal(rule.applies(ctxOf(analysis({ legalMoves: ['e2e4'] })), cfg), true);
    assert.equal(rule.applies(ctxOf(analysis({ legalMoves: ['e2e4', 'd2d4'] })), cfg), false);
  });

  it('BestRule fires only when the engine move was played', () => {
    const rule: ClassificationRule = new BestRule();
    assert.equal(rule.applies(ctxOf(analysis({ playedMove: 'e2e4', bestMove: 'e2e4' })), cfg), true);
    assert.equal(rule.applies(ctxOf(analysis({ playedMove: 'a2a3', bestMove: 'e2e4' })), cfg), false);
  });

  it('BrilliantRule needs material on offer, a sound position, depth and a real middlegame', () => {
    const rule = new BrilliantRule();
    const sac = (over = {}) => ctxOf(analysis({
      fenBefore: QUEEN_SAC.before, fenAfter: QUEEN_SAC.after,
      playedMove: QUEEN_SAC.uci, bestMove: QUEEN_SAC.uci,
      evalBefore: 300, bestEval: 300, evalAfter: 300, depth: 20, ...over,
    }));
    assert.equal(rule.applies(sac(), cfg), true);
    assert.equal(rule.applies(sac({ depth: 6 }), cfg), false, 'shallow search cannot tell sac from blunder');
    assert.equal(rule.applies(sac({ evalAfter: -800 }), cfg), false, 'a losing sacrifice is not brilliant');
    assert.equal(
      rule.applies(ctxOf(analysis({
        fenBefore: NO_SAC.before, fenAfter: NO_SAC.after,
        playedMove: NO_SAC.uci, bestMove: NO_SAC.uci, depth: 20,
      })), cfg),
      false, 'nothing offered, nothing brilliant',
    );
  });

  it('GreatRule declines rather than guessing without MultiPV', () => {
    const rule = new GreatRule();
    const withGap = (gap: number) => ctxOf(analysis({
      bestEval: 50, evalAfter: 50,
      alternatives: [
        { move: 'e2e4', scoreCp: 50, mateIn: null },
        { move: 'd2d4', scoreCp: 50 - gap, mateIn: null },
      ],
    }));
    assert.equal(rule.applies(withGap(900), cfg), true);
    assert.equal(rule.applies(withGap(10), cfg), false);
    assert.equal(rule.applies(ctxOf(analysis({ alternatives: undefined })), cfg), false);
  });

  it('MissRule fires on a forfeited mate and on a squandered win', () => {
    const rule = new MissRule();
    const mate = ctxOf(analysis({ playedMove: 'a2a3', bestMove: 'd1h5', mateBefore: 2, evalAfter: 150, bestEval: 2000 }));
    assert.equal(rule.applies(mate, cfg), true);
    assert.equal(rule.classify(mate, cfg).metadata!.missedMate, true);

    const won = ctxOf(analysis({ playedMove: 'a2a3', bestMove: 'd1d8', bestEval: 800, evalAfter: 0 }));
    assert.equal(rule.applies(won, cfg), true);

    const neverWinning = ctxOf(analysis({ playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 30, evalAfter: -200 }));
    assert.equal(rule.applies(neverWinning, cfg), false);
  });

  it('each band rule owns its own slice and nothing else', () => {
    // Each eval was checked against the win% curve to sit inside its own band:
    // drops of 0.9 / 3.5 / 6.9 / 16.2 / 28.3 against bounds 2 / 5 / 10 / 20 / inf.
    const cases: [QualityBandRule, number][] = [
      [new ExcellentRule(), 10],
      [new GoodRule(), -18],
      [new InaccuracyRule(), -55],
      [new MistakeRule(), -160],
      [new BlunderRule(), -320],
    ];
    for (const [rule, evalAfter] of cases) {
      const ctx = ctxOf(losing(evalAfter));
      assert.equal(rule.applies(ctx, cfg), true, `${rule.id} should own evalAfter=${evalAfter}`);
      assert.equal(rule.classify(ctx, cfg).classification, rule.classification);
    }
  });

  it('band rules follow reconfigured thresholds without a code change', () => {
    const strict = resolveConfig({ quality: { excellent: 0.1, good: 0.2, inaccuracy: 0.3, mistake: 0.4 } });
    const ctx = ctxOf(analysis({ playedMove: 'a2a3', bestMove: 'e2e4', bestEval: 20, evalAfter: 0 }));
    assert.equal(new ExcellentRule().applies(ctx, cfg), true);
    assert.equal(new ExcellentRule().applies(ctx, strict), false);
    assert.equal(new BlunderRule().applies(ctx, strict), true);
  });

  it('confidence drops near a band edge', () => {
    const edge = new MoveClassifier().classify(losing(-Math.round(DEFAULT_CONFIG.quality.good * 5.5)));
    const middle = new MoveClassifier().classify(losing(-1200));
    assert.ok(edge.confidence < middle.confidence);
  });
});
