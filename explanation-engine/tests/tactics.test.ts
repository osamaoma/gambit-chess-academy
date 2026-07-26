import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyUciMove, parseFen } from '../src/board';
import { detectTactics, MotifId, TacticFinding } from '../src/tactics';

/** Run the pure detector on `fen` for move `uci`. */
function find(fen: string, uci: string, engine: { mateIn?: number | null; pv?: string[] } = {}): TacticFinding[] {
  const before = parseFen(fen);
  const after = applyUciMove(before, uci);
  return detectTactics(before, after, uci, { mateIn: engine.mateIn ?? null, pv: engine.pv ?? [uci] });
}
const ids = (fs: TacticFinding[]): MotifId[] => fs.map((f) => f.id);
const get = (fs: TacticFinding[], id: MotifId) => fs.find((f) => f.id === id);

describe('detectTactics — verified motifs', () => {
  it('FORK: knight to c7 forks king and rook (royal fork, highest confidence)', () => {
    const fs = find('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    const fork = get(fs, 'fork');
    assert.ok(fork, 'expected a fork');
    assert.equal(fork.tier, 'verified');
    assert.equal(fork.confidence, 0.95); // a king is among the targets
    assert.match(fork.note, /knight on c7 attacks/);
    assert.match(fork.note, /king/);
    assert.match(fork.note, /rook on a8/);
  });

  it('PIN: bishop pins the knight to the king (absolute pin)', () => {
    const fs = find('3k4/8/5n2/8/8/8/8/2B1K3 w - - 0 1', 'c1g5');
    const pin = get(fs, 'pin');
    assert.ok(pin);
    assert.equal(pin.confidence, 0.92); // pinned to the king
    assert.match(pin.note, /pins the knight on f6 to the king/);
  });

  it('SKEWER: rook checks the king with a rook behind it', () => {
    const fs = find('r7/8/8/8/k7/8/8/4R1K1 w - - 0 1', 'e1a1');
    const sk = get(fs, 'skewer');
    assert.ok(sk);
    assert.match(sk.note, /skewers the king/);
    assert.match(sk.note, /rook on a8 falls/);
  });

  it('DISCOVERED CHECK: knight steps aside, unveiling a rook check', () => {
    const fs = find('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4d6');
    const dc = get(fs, 'discovered-check');
    assert.ok(dc);
    assert.equal(dc.confidence, 0.95);
    assert.match(dc.note, /uncovers a check from the rook on e1/);
  });

  it('BACK RANK: rook mates on the back rank behind the pawn shield', () => {
    const fs = find('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'e1e8');
    const br = get(fs, 'back-rank');
    assert.ok(br);
    assert.equal(br.tier, 'verified');
    assert.match(br.note, /back rank/);
  });

  it('MATE / MATING NET come from the engine score', () => {
    const mate = find('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'e1e8', { mateIn: 1 });
    assert.equal(get(mate, 'mate')?.confidence, 0.97);
    const net = find('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7', { mateIn: 4 });
    assert.ok(get(net, 'mating-net'));
    assert.match(get(net, 'mating-net')!.note, /mate in 4/);
  });

  it('sorts strongest-first and finds nothing on a quiet move', () => {
    assert.deepEqual(find('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4'), []);
    const fs = find('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'e1e8', { mateIn: 1 });
    assert.ok(fs[0]!.confidence >= fs[fs.length - 1]!.confidence);
  });
});

describe('detectTactics — heuristic motifs (best-effort, tier heuristic)', () => {
  it('OVERLOADED: captures a piece whose lone defender also guards another target', () => {
    const fs = find('6k1/1b2r3/8/4n3/8/5N2/8/1R4K1 w - - 0 1', 'f3e5');
    const ov = get(fs, 'overloaded');
    assert.ok(ov, `expected overloaded, got ${ids(fs).join(',') || 'none'}`);
    assert.equal(ov.tier, 'heuristic');
    assert.match(ov.note, /bishop on b7/);
    // and crucially: no verified motif competes here
    assert.equal(fs.some((f) => f.tier === 'verified'), false);
  });

  it('DECOY: a sacrifice lures the king, then a knight fork wins the queen', () => {
    const fs = find('7k/7p/8/3q3Q/4N3/8/8/6K1 w - - 0 1', 'h5h7', { pv: ['h5h7', 'h8h7', 'e4f6'] });
    assert.ok(get(fs, 'decoy'), `expected decoy, got ${ids(fs).join(',') || 'none'}`);
    assert.equal(get(fs, 'decoy')!.tier, 'heuristic');
  });

  it('DEFLECTION: a check drives the king off, then a knight fork wins the rook', () => {
    const fs = find('4k3/r7/1N6/8/8/8/8/3R2K1 w - - 0 1', 'd1d8', { pv: ['d1d8', 'e8e7', 'b6c8'] });
    assert.ok(get(fs, 'deflection'), `expected deflection, got ${ids(fs).join(',') || 'none'}`);
    assert.equal(fs.some((f) => f.tier === 'verified'), false);
  });
});
