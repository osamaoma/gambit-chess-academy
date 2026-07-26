import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseFen, squareColor } from '../src/board';
import {
  bishopQuality,
  isOpenFile,
  isOutpostSquare,
  isSemiOpenFile,
  outpostSupported,
  ownPawnsOnColor,
  pieceMobility,
  rooksConnected,
} from '../src/positional';

describe('positional geometry', () => {
  it('square colours (a1 dark, h1 light)', () => {
    assert.equal(squareColor('a1'), 'dark');
    assert.equal(squareColor('h1'), 'light');
    assert.equal(squareColor('e4'), 'light');
    assert.equal(squareColor('d4'), 'dark');
  });

  it('mobility counts empty + enemy squares, not own blockers', () => {
    // Lone rook, nothing in its way: rank (7) + file (7) = 14.
    assert.equal(pieceMobility(parseFen('4k3/8/8/8/8/8/8/R7 w - - 0 1'), 'a1'), 14);
    // Knight in the corner: only b3 and c2 → 2.
    assert.equal(pieceMobility(parseFen('4k3/8/8/8/8/8/8/N7 w - - 0 1'), 'a1'), 2);
    // Rook behind its own pawn: the file is blocked at a2, leaving the rank (7).
    assert.equal(pieceMobility(parseFen('4k3/8/8/8/8/8/P7/R7 w - - 0 1'), 'a1'), 7);
  });

  it('open and half-open files', () => {
    const b = parseFen('4k3/8/8/8/8/8/P7/R3K3 w - - 0 1'); // pawn on a2 only
    assert.equal(isOpenFile(b, 3), true);            // d-file empty
    assert.equal(isOpenFile(b, 0), false);           // a-file has the pawn
    assert.equal(isSemiOpenFile(b, 0, 'white'), false); // white owns the a-pawn
    assert.equal(isSemiOpenFile(b, 0, 'black'), true);  // black has no a-pawn
  });

  it('bishop quality: bad when hemmed by same-colour pawns, good when open', () => {
    // Four white pawns on light squares (b3 d3 f3 h3) wall in the light bishop g2.
    const bad = parseFen('4k3/8/8/8/8/1P1P1P1P/6B1/4K3 w - - 0 1');
    assert.equal(ownPawnsOnColor(bad, 'white', 'light'), 4);
    assert.equal(bishopQuality(bad, 'g2'), 'bad');
    // Lone bishop on a long open diagonal.
    assert.equal(bishopQuality(parseFen('4k3/8/8/8/8/8/1B6/4K3 w - - 0 1'), 'b2'), 'good');
  });

  it('outposts: enemy half, unassailable by pawns, and pawn support', () => {
    // White knight e5 with a black pawn only on f7 (can advance to attack) → NOT an outpost.
    const attackable = parseFen('4k3/5p2/8/4N3/8/8/8/4K3 w - - 0 1');
    assert.equal(isOutpostSquare(attackable, 'e5', 'white'), false);
    // No enemy pawns on d/f → e5 is an outpost; a white pawn on d4 supports it.
    const outpost = parseFen('4k3/8/8/4N3/3P4/8/8/4K3 w - - 0 1');
    assert.equal(isOutpostSquare(outpost, 'e5', 'white'), true);
    assert.equal(outpostSupported(outpost, 'e5', 'white'), true);
    // Own half of the board is never an outpost.
    assert.equal(isOutpostSquare(outpost, 'e2', 'white'), false);
  });

  it('connected rooks', () => {
    assert.equal(rooksConnected(parseFen('4k3/8/8/8/8/8/8/R5R1 w - - 0 1'), 'white'), true);
    // King between them breaks the connection.
    assert.equal(rooksConnected(parseFen('4k3/8/8/8/8/8/8/R3K2R w - - 0 1'), 'white'), false);
  });
});
