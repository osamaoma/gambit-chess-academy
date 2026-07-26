import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import {
  TacticalDetector,
  TacticalMotifDetector,
  tacticalDetectors,
} from '../src/detectors/tactical';
import { EngineEval, MoveClassification, MoveContext } from '../src/types';
import { makeCtx } from './helpers';

function ev(uci: string, opts: { mateIn?: number | null; pv?: string[] } = {}): EngineEval {
  return { uci, scoreCp: 300, mateIn: opts.mateIn ?? null, pv: opts.pv ?? [uci], depth: 16, alternatives: [] };
}

/** A context whose engine best move is `bestUci`. By default the player found it. */
function ctx(
  fenBefore: string,
  bestUci: string,
  over: { played?: string; classification?: MoveClassification; san?: string; mateIn?: number | null; pv?: string[] } = {},
): MoveContext {
  return makeCtx({
    fenBefore,
    uci: over.played ?? bestUci,
    san: over.san ?? 'Nc7+',
    classification: over.classification ?? 'best',
    evalBefore: ev(bestUci, over),
  });
}

// The knight-fork position from the tactics suite (best move = b5c7).
const FORK = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';

describe('TacticalDetector (verified)', () => {
  const d = () => new TacticalDetector();

  it('praises a tactic the player found', () => {
    const r = d().detect(ctx(FORK, 'b5c7', { played: 'b5c7', san: 'Nc7+', classification: 'brilliant' }));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'verified');
    assert.equal(r.confidence, 0.95);
    assert.match(r.explanation!.headline, /Nc7\+ — a fork!/);
    assert.match(r.explanation!.detail, /Well spotted/);
    assert.ok(r.explanation!.tags.includes('fork'));
    // no "play the engine's move" tip when you already did
    assert.equal(r.explanation!.improvements.some((i) => i.moveUci), false);
  });

  it('coaches a tactic the player missed, with the move as an improvement', () => {
    const r = d().detect(ctx(FORK, 'b5c7', { played: 'e1e2', san: 'Ke2', classification: 'blunder' }));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /You missed a fork\./);
    const tip = r.explanation!.improvements[0];
    assert.equal(tip?.moveUci, 'b5c7');
    assert.match(tip!.advice, /Play the engine's move/);
  });

  it('has high priority so tactics lead over material/king-safety talk', () => {
    assert.equal(d().priority, 30);
  });

  it('does not fire when the best move has no verified tactic', () => {
    const r = d().detect(ctx('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4', { san: 'e4', classification: 'good' }));
    assert.equal(r.applies, false);
  });

  it('ignores heuristic-only positions (leaves them to the motif detector)', () => {
    const overloaded = ctx('6k1/1b2r3/8/4n3/8/5N2/8/1R4K1 w - - 0 1', 'f3e5', { san: 'Nxe5', classification: 'good' });
    assert.equal(d().detect(overloaded).applies, false);
  });
});

describe('TacticalMotifDetector (heuristic)', () => {
  it('fires on a heuristic pattern at the heuristic tier', () => {
    const overloaded = ctx('6k1/1b2r3/8/4n3/8/5N2/8/1R4K1 w - - 0 1', 'f3e5', { san: 'Nxe5', classification: 'good' });
    const r = new TacticalMotifDetector().detect(overloaded);
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.ok(r.explanation!.tags.includes('overloaded'));
  });

  it('stays silent when a verified tactic is what is really going on', () => {
    const r = new TacticalMotifDetector().detect(ctx(FORK, 'b5c7', { played: 'b5c7' }));
    assert.equal(r.applies, false); // the fork is verified, not heuristic
  });
});

describe('tier dominance through the engine', () => {
  it('a verified fork outranks any heuristic on the same move', () => {
    // The knight fork position — register BOTH tactical detectors.
    const registry = new DetectorRegistry().registerAll(tacticalDetectors());
    const out = new ExplanationEngine(registry).explainMove(
      ctx(FORK, 'b5c7', { played: 'b5c7', san: 'Nc7+', classification: 'best' }),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'tactics'); // verified detector wins
    assert.match(out.headline, /fork/);
  });

  it('the heuristic detector carries a move when no verified tactic exists', () => {
    const registry = new DetectorRegistry().registerAll(tacticalDetectors());
    const out = new ExplanationEngine(registry).explainMove(
      ctx('4k3/r7/1N6/8/8/8/8/3R2K1 w - - 0 1', 'd1d8', {
        san: 'Rd8+', classification: 'miss', pv: ['d1d8', 'e8e7', 'b6c8'],
      }),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'tactics-pattern');
    assert.match(out.headline, /deflection/i);
  });
});
