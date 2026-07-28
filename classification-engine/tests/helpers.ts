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

/**
 * A REAL queen sacrifice: Morphy–Duke of Brunswick, Paris 1858, 16.Qb8+!!
 * (met by 16...Nxb8 17.Rd8#).
 *
 * The earlier fixture here simply deleted white's queen from the after-FEN — a
 * position no legal move produces. That made the Brilliant test pass against an
 * implementation that could never fire on a real game, which a comparison run
 * against actual Stockfish output exposed. Real positions only from now on.
 */
export const QUEEN_SAC = {
  before: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
  after: '1Q2kb1r/p2n1ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 b k - 1 16',
  uci: 'b3b8',
};

/** The same position AFTER a quiet move, where nothing is on offer. */
export const NO_SAC = {
  before: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
  after: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/1K1R4 b k - 1 16',
  uci: 'c1b1',
};
