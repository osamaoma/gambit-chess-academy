import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseFen, staticExchangeEval as see } from '../src/board';

const evalSee = (fen: string, from: string, to: string) => see(parseFen(fen), from, to);

describe('staticExchangeEval', () => {
  it('wins a fully undefended piece', () => {
    // Bc4xf7, black king on d8 too far to defend f7.
    assert.equal(evalSee('3k4/5n2/8/8/2B5/8/8/4K3 w - - 0 1', 'c4', 'f7'), 3);
  });

  it('scores an even pawn trade as 0', () => {
    // exd5, recaptured by the e6 pawn.
    assert.equal(evalSee('4k3/8/4p3/3p4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5'), 0);
  });

  it('scores losing the exchange (rook for a defended bishop) as -2', () => {
    // Rxb5, recaptured by the c6 pawn.
    assert.equal(evalSee('4k3/8/2p5/1b6/8/8/1R6/4K3 w - - 0 1', 'b2', 'b5'), -2);
  });

  it('scores queen-takes-defended-knight as -6', () => {
    // Qxd5, recaptured by the e6 pawn: won a knight (+3), lost the queen (-9).
    assert.equal(evalSee('4k3/8/4p3/3n4/8/8/Q7/6K1 w - - 0 1', 'a2', 'd5'), -6);
  });

  it('rewards a favourable exchange when attackers outnumber defenders (+1)', () => {
    // Nxe5: knight defended once (d6 pawn) but attacked twice (Nf3 + Re1).
    assert.equal(evalSee('4k3/8/3p4/4n3/8/5N2/8/4R1K1 w - - 0 1', 'f3', 'e5'), 1);
  });

  it('scores a non-capturing move onto an attacked, undefended square as negative', () => {
    // Nf5 walks in front of the e6 and g6 pawns — the knight is simply lost.
    assert.equal(evalSee('4k3/8/4p1p1/8/3N4/8/8/4K3 w - - 0 1', 'd4', 'f5'), -3);
  });

  it('reveals x-ray attackers between captures (a battery wins a defended rook)', () => {
    // Doubled rooks e1+e2 hit a black rook on e5 defended by the d6 pawn.
    // Rxe5 dxe5 Rxe5 nets +1 — but only because the rear rook is revealed after
    // the front one is captured. Without the x-ray this would be an even 0.
    assert.equal(evalSee('4k3/8/3p4/4r3/8/8/4R3/4R1K1 w - - 0 1', 'e2', 'e5'), 1);
  });

  it('returns 0 for a quiet move to a safe empty square', () => {
    assert.equal(evalSee('4k3/8/8/8/8/5N2/8/4K3 w - - 0 1', 'f3', 'g5'), 0);
  });
});
