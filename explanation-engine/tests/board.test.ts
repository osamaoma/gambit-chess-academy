import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  canCastle,
  describePiece,
  isCaptureUci,
  isCastlingUci,
  isDevelopingUci,
  isHomeSquare,
  kingOnHome,
  parseFen,
  parseUciMove,
  undevelopedMinors,
} from '../src/board';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** After 1.e4 e5 2.Bc4 Nf6 — white bishop out, white knights home, black knight out. */
const ITALIANISH = 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3';
/** Castled-ready: white can play e1g1. */
const CASTLE_READY = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 4 6';

describe('board', () => {
  it('parses a FEN into squares, side to move and castling rights', () => {
    const b = parseFen(START);
    assert.equal(b.squares.size, 32);
    assert.deepEqual(b.squares.get('e1'), { color: 'white', type: 'k' });
    assert.deepEqual(b.squares.get('g8'), { color: 'black', type: 'n' });
    assert.equal(b.sideToMove, 'white');
    assert.equal(b.castling, 'KQkq');
  });

  it('rejects malformed FENs and UCI moves', () => {
    assert.throws(() => parseFen('not-a-fen'));
    assert.throws(() => parseFen('rnbqkbnr/pppppppp w KQkq - 0 1'));
    assert.throws(() => parseUciMove('e9e4'));
    assert.throws(() => parseUciMove('castle'));
  });

  it('parses promotion UCI moves', () => {
    assert.deepEqual(parseUciMove('e7e8q'), { from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('knows home squares per colour', () => {
    assert.equal(isHomeSquare('white', 'n', 'g1'), true);
    assert.equal(isHomeSquare('black', 'n', 'g1'), false);
    assert.equal(isHomeSquare('black', 'b', 'c8'), true);
    assert.equal(isHomeSquare('white', 'q', 'd4'), false);
  });

  it('lists undeveloped minors', () => {
    assert.deepEqual(undevelopedMinors(parseFen(START), 'white'), ['b1', 'c1', 'f1', 'g1']);
    const b = parseFen(ITALIANISH);
    assert.deepEqual(undevelopedMinors(b, 'white'), ['b1', 'c1', 'g1']); // Bc4 is out
    assert.deepEqual(undevelopedMinors(b, 'black'), ['b8', 'c8', 'f8']); // Nf6 is out
  });

  it('tracks king-home and castling rights', () => {
    const b = parseFen(CASTLE_READY);
    assert.equal(kingOnHome(b, 'white'), true);
    assert.equal(canCastle(b, 'white'), true);
    const none = parseFen('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b kq - 5 6');
    assert.equal(kingOnHome(none, 'white'), false);
    assert.equal(canCastle(none, 'white'), false);
    assert.equal(canCastle(none, 'black'), true);
  });

  it('detects captures (opposite colour on the target square only)', () => {
    const b = parseFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
    assert.equal(isCaptureUci(b, 'e4d5'), true);
    assert.equal(isCaptureUci(b, 'e4e5'), false);
  });

  it('detects castling as a two-file king move off home', () => {
    const b = parseFen(CASTLE_READY);
    assert.equal(isCastlingUci(b, 'e1g1'), true);
    assert.equal(isCastlingUci(b, 'e1f1'), false);   // king step, not castling
    assert.equal(isCastlingUci(b, 'c4b3'), false);   // not a king
  });

  it('classifies developing moves: minor off home, or castling', () => {
    const start = parseFen(START);
    assert.equal(isDevelopingUci(start, 'g1f3'), true);
    assert.equal(isDevelopingUci(start, 'e2e4'), false);        // pawn
    assert.equal(isDevelopingUci(start, 'a1a3'), false);        // rook lift ≠ development
    const b = parseFen(ITALIANISH);
    assert.equal(isDevelopingUci(b, 'c4b3'), false);            // bishop ALREADY developed
    assert.equal(isDevelopingUci(b, 'b1c3'), true);
    assert.equal(isDevelopingUci(parseFen(CASTLE_READY), 'e1g1'), true); // castling counts
  });

  it('describes pieces for prose', () => {
    assert.equal(describePiece(parseFen(START), 'g1'), 'knight on g1');
    assert.equal(describePiece(parseFen(START), 'e5'), 'piece on e5');
  });
});
