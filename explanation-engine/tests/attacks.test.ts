import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { attackersOf, attacks, hangingPieces, otherColor, parseFen } from '../src/board';

describe('attack geometry', () => {
  it('pawns attack diagonally forward, by colour', () => {
    const b = parseFen('8/8/8/3p4/4P3/8/8/K6k w - - 0 1');
    assert.deepEqual(attacks(b, 'e4').sort(), ['d5', 'f5']);
    assert.deepEqual(attacks(b, 'd5').sort(), ['c4', 'e4']);
  });

  it('knights use the L, clipped at the board edge', () => {
    const b = parseFen('8/8/8/8/8/8/8/N6k w - - 0 1');
    assert.deepEqual(attacks(b, 'a1').sort(), ['b3', 'c2']);
  });

  it('sliders stop at (and include) the first blocker', () => {
    //白 rook a1, own pawn a3 — the rook sees a2 and a3, not beyond.
    const b = parseFen('8/8/8/8/8/P7/8/R6k w - - 0 1');
    const seen = attacks(b, 'a1');
    assert.ok(seen.includes('a2'));
    assert.ok(seen.includes('a3'));
    assert.equal(seen.includes('a4'), false);
  });

  it('finds attackers of a square by colour', () => {
    // Black knight c6 and black pawn f6 both hit e5; white pawn d4 hits it too.
    // (A black pawn on d5 would attack c4/e4 — pawns capture toward THEIR side.)
    const b = parseFen('8/8/2n2p2/8/3P4/8/8/K6k w - - 0 1');
    assert.deepEqual(attackersOf(b, 'e5', 'black'), ['c6', 'f6']);
    assert.deepEqual(attackersOf(b, 'e5', 'white'), ['d4']);
  });

  it('otherColor flips', () => {
    assert.equal(otherColor('white'), 'black');
    assert.equal(otherColor('black'), 'white');
  });
});

describe('hangingPieces', () => {
  it('flags an attacked, undefended piece', () => {
    // White bishop c4 attacks black knight f7; the king sits on d8, too far to defend.
    const b = parseFen('3k4/5n2/8/8/2B5/8/8/4K3 w - - 0 1');
    const hangs = hangingPieces(b, 'black');
    assert.equal(hangs.length, 1);
    assert.equal(hangs[0]?.square, 'f7');
    assert.equal(hangs[0]?.reason, 'undefended');
    assert.deepEqual(hangs[0]?.attackers, ['c4']);
    assert.deepEqual(hangs[0]?.defenders, []);
  });

  it('flags a defended piece attacked by something cheaper', () => {
    // Black queen d5 IS defended (pawn e6) but a white pawn on e4 attacks it:
    // the recapture still loses queen-for-pawn.
    const b = parseFen('4k3/8/4p3/3q4/4P3/8/8/4K3 w - - 0 1');
    const hangs = hangingPieces(b, 'black');
    assert.equal(hangs[0]?.square, 'd5');
    assert.equal(hangs[0]?.reason, 'cheaper-attacker');
  });

  it('flags a piece with more attackers than defenders', () => {
    // Black knight e5: attacked by Nf3+Rе1(2), defended by pawn d6(1).
    const b = parseFen('4k3/8/3p4/4n3/8/5N2/8/4R2K w - - 0 1');
    const hangs = hangingPieces(b, 'black');
    assert.equal(hangs[0]?.square, 'e5');
    assert.equal(hangs[0]?.reason, 'outnumbered');
    assert.equal(hangs[0]?.attackers.length, 2);
    assert.equal(hangs[0]?.defenders.length, 1);
  });

  it('does NOT flag an equally-defended piece attacked by equal material', () => {
    // Knight e5 attacked by Nf3, defended by pawn d6 — 1 vs 1, attacker not cheaper.
    const b = parseFen('4k3/8/3p4/4n3/8/5N2/8/6K1 w - - 0 1');
    assert.deepEqual(hangingPieces(b, 'black'), []);
  });

  it('skips kings entirely (that is check, not hanging)', () => {
    const b = parseFen('4k3/8/8/8/8/8/4R3/6K1 w - - 0 1');
    assert.deepEqual(hangingPieces(b, 'black'), []);
  });

  it('ignores an enemy king as the attacker of a defended piece', () => {
    // Black pawn e5 defended by f6 pawn; only the white KING attacks it —
    // the king can never take a defended piece, so this is not hanging.
    const b = parseFen('8/8/5p2/4p3/4K3/8/8/7k w - - 0 1');
    assert.deepEqual(hangingPieces(b, 'black'), []);
  });

  it('sorts most valuable first', () => {
    // Black queen d5 (attacked by Bg2) and black pawn a7 (attacked by Ra1),
    // both undefended.
    const b = parseFen('4k3/p7/8/3q4/8/8/6B1/R3K3 w - - 0 1');
    const hangs = hangingPieces(b, 'black');
    assert.equal(hangs.length, 2);
    assert.equal(hangs[0]?.square, 'd5');   // queen (9) before pawn (1)
    assert.equal(hangs[1]?.square, 'a7');
  });
});
