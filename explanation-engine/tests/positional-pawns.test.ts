import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseFen } from '../src/board';
import {
  chainBase,
  doubledPawnFiles,
  isBackwardPawn,
  isIsolatedPawn,
  isPassedPawn,
  pawnChains,
  wingPawnCounts,
} from '../src/positional';

describe('pawn-structure primitives', () => {
  it('isolated pawns', () => {
    const b = parseFen('4k3/8/8/8/8/8/P2P2P1/4K3 w - - 0 1'); // a2 d2 g2, all with empty neighbours
    assert.equal(isIsolatedPawn(b, 'd2', 'white'), true);
    const c = parseFen('4k3/8/8/8/8/8/2PP4/4K3 w - - 0 1'); // c2 d2 adjacent
    assert.equal(isIsolatedPawn(c, 'd2', 'white'), false);
  });

  it('doubled pawns', () => {
    const b = parseFen('4k3/8/8/8/3P4/8/3P4/4K3 w - - 0 1'); // d2 & d4
    assert.deepEqual(doubledPawnFiles(b, 'white'), [3]);
    assert.deepEqual(doubledPawnFiles(parseFen('4k3/8/8/8/8/8/2PP4/4K3 w - - 0 1'), 'white'), []);
  });

  it('passed pawns', () => {
    const passed = parseFen('4k3/pp6/8/4P3/8/8/8/4K3 w - - 0 1'); // e5, black pawns only a7/b7
    assert.equal(isPassedPawn(passed, 'e5', 'white'), true);
    const blocked = parseFen('4k3/5p2/8/4P3/8/8/8/4K3 w - - 0 1'); // black f7 guards the e-pawn's path
    assert.equal(isPassedPawn(blocked, 'e5', 'white'), false);
  });

  it('backward pawns', () => {
    // White d3 with neighbours advanced to c4/e4 and a black pawn e5 covering d4.
    const b = parseFen('4k3/8/8/4p3/2P1P3/3P4/8/4K3 w - - 0 1');
    assert.equal(isBackwardPawn(b, 'd3', 'white'), true);
    // If a neighbour can drop back (c2 instead of c4), it isn't backward.
    const c = parseFen('4k3/8/8/4p3/4P3/3P4/2P5/4K3 w - - 0 1');
    assert.equal(isBackwardPawn(c, 'd3', 'white'), false);
  });

  it('pawn chains and their base', () => {
    const b = parseFen('4k3/8/8/8/3P4/2P5/1P6/4K3 w - - 0 1'); // b2–c3–d4 chain
    const chains = pawnChains(b, 'white');
    assert.equal(chains.length, 1);
    assert.equal(chains[0]!.length, 3);
    assert.equal(chainBase(chains[0]!, 'white'), 'b2'); // rearmost pawn
  });

  it('wing pawn counts (a–c queenside, f–h kingside)', () => {
    const b = parseFen('4k3/8/8/8/8/8/PPP2PPP/4K3 w - - 0 1');
    assert.deepEqual(wingPawnCounts(b, 'white'), { queenside: 3, kingside: 3 });
  });
});
