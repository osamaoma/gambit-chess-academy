/**
 * Fixture builder. Every test states ONLY the fields it cares about, so a test
 * reads as the scenario it describes rather than a wall of boilerplate.
 */

import { MoveAnalysis } from '../src/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

/** A quiet, unremarkable white move at a healthy depth. */
export function analysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    fenBefore: START,
    fenAfter: AFTER_E4,
    playedMove: 'e2e4',
    bestMove: 'e2e4',
    evalBefore: 20,
    evalAfter: 20,
    bestEval: 20,
    centipawnLoss: 0,
    mateBefore: null,
    mateAfter: null,
    principalVariation: ['e2e4', 'e7e5'],
    depth: 18,
    legalMoves: ['e2e4', 'd2d4', 'g1f3'],
    phase: 'opening',
    opening: null,
    mover: 'white',
    ...overrides,
  };
}

/** Positions used by the sacrifice tests: white is a full queen down. */
export const QUEEN_SAC = {
  before: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 12',
  after: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 12',
};
