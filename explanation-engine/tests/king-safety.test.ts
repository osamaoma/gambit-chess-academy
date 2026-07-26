import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseFen } from '../src/board';
import {
  analyzeKingSafety,
  computeKingSafetySignals,
  KingSafetyDetector,
} from '../src/detectors/king-safety';
import { DevelopmentDetector } from '../src/detectors/development';
import { ExplanationEngine } from '../src/engine';
import { DetectorRegistry } from '../src/registry';
import { EngineEval, MoveClassification, MoveContext } from '../src/types';
import { makeCtx } from './helpers';

function best(uci: string): EngineEval {
  return { uci, scoreCp: 20, mateIn: null, pv: [uci], depth: 14, alternatives: [] };
}
function ctx(
  fenBefore: string, fenAfter: string, uci: string, bestUci: string,
  classification: MoveClassification = 'inaccuracy', ply = 11,
): MoveContext {
  return makeCtx({ fenBefore, fenAfter, uci, san: uci, ply, mover: 'white', classification, evalBefore: best(bestUci) });
}

/* Positions (white to move, mover = white) */
const CASTLE_AVAILABLE = '4k3/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1';
const KE1_EPAWN_OUT = '4k3/pppppppp/8/8/4P3/8/PPPP1PPP/R3K2R w KQ - 0 1';
const CASTLED_INTACT = '6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1';
const OPENS_F_FILE_BEFORE = '6k1/6pp/8/8/8/4p3/5PPP/6K1 w - - 0 1';

describe('analyzeKingSafety', () => {
  it('sees a castled king with an intact shield as safe', () => {
    const s = analyzeKingSafety(parseFen(CASTLED_INTACT), 'white');
    assert.equal(s.square, 'g1');
    assert.equal(s.shieldPresent, 3);
    assert.deepEqual(s.openFiles, []);
    assert.equal(s.danger, 0);
  });

  it('counts a missing shield pawn and the open file it leaves', () => {
    // King g1, pawns g2+h2 but NO f-pawn → the f-file is open beside the king.
    const s = analyzeKingSafety(parseFen('6k1/6pp/8/8/8/8/6PP/6K1 w - - 0 1'), 'white');
    assert.equal(s.shieldPresent, 2);
    assert.deepEqual(s.openFiles, ['f']);
    assert.deepEqual(s.fullyOpenFiles, ['f']);
    assert.equal(s.danger, 3); // 1 open file (×2) + 1 missing shield
  });

  it('counts an advanced central pawn as a small king-safety cost for an uncastled king', () => {
    const s = analyzeKingSafety(parseFen(KE1_EPAWN_OUT), 'white');
    assert.equal(s.square, 'e1');
    assert.equal(s.shieldPresent, 2); // d2, f2 — e2 vacated
    assert.equal(s.danger, 1);
  });
});

describe('computeKingSafetySignals', () => {
  it('flags a missed castling', () => {
    const s = computeKingSafetySignals(ctx(CASTLE_AVAILABLE, '4k3/pppppppp/8/8/8/7P/PPPPPPP1/R3K2R b KQ - 0 1', 'h2h3', 'e1g1'));
    assert.equal(s.missedCastling, true);
    assert.equal(s.castleUci, 'e1g1');
  });

  it('flags an unnecessary king move that forfeits castling', () => {
    const s = computeKingSafetySignals(ctx(KE1_EPAWN_OUT, '4k3/pppppppp/8/8/4P3/8/PPPPKPPP/R6R b - - 1 1', 'e1e2', 'g1f3'));
    assert.equal(s.unnecessaryKingMove, true);
  });

  it('flags a weakened pawn shield (a shield pawn pushed forward)', () => {
    const s = computeKingSafetySignals(ctx(CASTLED_INTACT, '6k1/5ppp/8/8/6P1/8/5P1P/6K1 b - - 0 1', 'g2g4', 'g1h1'));
    assert.equal(s.shieldWeakened, true);
    assert.equal(s.fileOpened, false); // g4 still shelters the g-file
  });

  it('flags a file opened next to the king', () => {
    const s = computeKingSafetySignals(ctx(OPENS_F_FILE_BEFORE, '6k1/6pp/8/8/8/4P3/6PP/6K1 b - - 0 1', 'f2e3', 'g1h1'));
    assert.equal(s.fileOpened, true);
    assert.equal(s.newOpenFile, 'f');
  });

  it('does not flag a quiet move in a safe castled position', () => {
    const s = computeKingSafetySignals(ctx(CASTLED_INTACT, '6k1/5ppp/8/8/8/5N2/5PPP/6K1 b - - 0 1', 'g1f3', 'a1a1'));
    // (an artificial "king walks to f3" is illegal chess but exercises "no weakness")
    assert.equal(s.weakened, false);
  });
});

describe('KingSafetyDetector', () => {
  const d = () => new KingSafetyDetector();

  it('explains missed castling with its strategic consequence + castle tip', () => {
    const r = d().detect(ctx(CASTLE_AVAILABLE, '4k3/pppppppp/8/8/8/7P/PPPPPPP1/R3K2R b KQ - 0 1', 'h2h3', 'e1g1'));
    assert.equal(r.applies, true);
    assert.equal(r.tier, 'heuristic');
    assert.match(r.explanation!.headline, /king in the centre/);
    assert.match(r.explanation!.detail, /rooks stay disconnected|open lines/);
    assert.ok(r.explanation!.tags.includes('castling'));
    assert.equal(r.explanation!.improvements[0]?.moveUci, 'e1g1');
    assert.match(r.explanation!.improvements[0]!.advice, /Castle/);
  });

  it('explains an unnecessary king move', () => {
    const r = d().detect(ctx(KE1_EPAWN_OUT, '4k3/pppppppp/8/8/4P3/8/PPPPKPPP/R6R b - - 1 1', 'e1e2', 'g1f3'));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /gives up castling/);
    assert.match(r.explanation!.detail, /tempo|crawl to safety/);
  });

  it('explains an opened file beside the king (open-file tag)', () => {
    const r = d().detect(ctx(OPENS_F_FILE_BEFORE, '6k1/6pp/8/8/8/4P3/6PP/6K1 b - - 0 1', 'f2e3', 'g1h1'));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /opens the f-file/);
    assert.ok(r.explanation!.tags.includes('open-file'));
  });

  it('explains a weakened pawn shield (pawn-shield tag)', () => {
    const r = d().detect(ctx(CASTLED_INTACT, '6k1/5ppp/8/8/6P1/8/5P1P/6K1 b - - 0 1', 'g2g4', 'g1h1'));
    assert.equal(r.applies, true);
    assert.match(r.explanation!.headline, /weakens the pawns/);
    assert.ok(r.explanation!.tags.includes('pawn-shield'));
    assert.match(r.explanation!.detail, /never move backwards|permanent holes/);
  });

  it('does not apply when the king is safe', () => {
    const r = d().detect(ctx(CASTLED_INTACT, '6k1/5ppp/8/8/8/5N2/5PPP/6K1 b - - 0 1', 'g1f3', 'a1a1'));
    assert.equal(r.applies, false);
  });

  it('handles only slow errors (inaccuracy/mistake), not tactical ones', () => {
    const det = d();
    assert.deepEqual([...det.classifications], ['inaccuracy', 'mistake']);
    for (const c of ['blunder', 'book', 'good', 'brilliant'] as const) {
      assert.equal(det.classifications.includes(c), false);
    }
  });

  it('outranks the development detector on a missed castling (both heuristic)', () => {
    const registry = new DetectorRegistry().registerAll([
      new KingSafetyDetector(),
      new DevelopmentDetector(),
    ]);
    const out = new ExplanationEngine(registry).explainMove(
      ctx(CASTLE_AVAILABLE, '4k3/pppppppp/8/8/8/7P/PPPPPPP1/R3K2R b KQ - 0 1', 'h2h3', 'e1g1'),
    );
    assert.ok(out);
    assert.equal(out.sources[0], 'king-safety'); // priority 8 > development 5
    assert.ok(out.tags.includes('king-safety'));
  });
});
