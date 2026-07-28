/**
 * Tactical motif detection — the reusable geometry shared by the tactical
 * detectors. Pure functions over two board snapshots (before / after a move);
 * no engine, no move generation (mate facts come from the engine's score).
 *
 * Every motif carries its own intrinsic {@link ConfidenceTier}:
 *  - geometric motifs (fork, pin, skewer, discovered attack/check, double
 *    attack, x-ray, back-rank) and engine-confirmed mates are `verified` —
 *    provable from the board / the engine's own mate score;
 *  - overloaded defender, deflection and decoy are `heuristic` — pattern
 *    guesses from the principal variation that may occasionally misfire.
 *
 * Keeping the tier ON the finding lets the two tactical detectors split cleanly
 * by tier, so the selector's rule ("a heuristic can never outrank a verified
 * result") is enforced for tactics too.
 */

import {
  attackersOfSquares,
  attacksFrom,
  applyUciMove,
  Board,
  isInCheck,
  kingSquareOf,
  otherColor,
  parseUciMove,
  PIECE_VALUES,
  pieceName,
  Piece,
} from './board';
import { ConfidenceTier } from './detector';

export type MotifId =
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'discovered-check'
  | 'double-attack'
  | 'xray'
  | 'mate'
  | 'mating-net'
  | 'back-rank'
  | 'overloaded'
  | 'deflection'
  | 'decoy';

export interface TacticFinding {
  readonly id: MotifId;
  readonly label: string;
  /** 0–1 — how clearly the motif is present. */
  readonly confidence: number;
  readonly tier: ConfidenceTier;
  /** A concrete clause describing THIS instance ("the knight on e5 attacks the king and the rook on a1"). */
  readonly note: string;
  /** Square the motif acts FROM (the attacking piece), when the geometry names one. */
  readonly from?: string;
  /** Squares the motif acts UPON (the forked pieces, the pinned piece and what it shields). */
  readonly targets?: readonly string[];
}

/** Minimal engine facts the heuristics and mate detection use. */
export interface TacticEngineInfo {
  /** Moves to mate from the pre-move position (positive = the mover mates), or null. */
  readonly mateIn: number | null;
  /** Principal variation as UCI, best line first. */
  readonly pv: readonly string[];
}

const LABEL: Record<MotifId, string> = {
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  'discovered-attack': 'Discovered attack',
  'discovered-check': 'Discovered check',
  'double-attack': 'Double attack',
  xray: 'X-ray attack',
  mate: 'Checkmate',
  'mating-net': 'Mating net',
  'back-rank': 'Back-rank mate',
  overloaded: 'Overloaded defender',
  deflection: 'Deflection',
  decoy: 'Decoy',
};

const R_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const B_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
type Dir = readonly [number, number];

function slideDirs(type: Piece['type']): readonly Dir[] {
  return type === 'r' ? R_DIRS : type === 'b' ? B_DIRS : [...R_DIRS, ...B_DIRS];
}

const fileIdx = (sq: string): number => sq.charCodeAt(0) - 97;
const rankIdx = (sq: string): number => Number(sq.charAt(1));
function squareAt(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return 'abcdefgh'.charAt(file) + String(rank);
}

/** Occupied squares along a ray (up to two). */
function rayHits(sqs: Board['squares'], from: string, dx: number, dy: number): string[] {
  const hits: string[] = [];
  let f = fileIdx(from) + dx;
  let r = rankIdx(from) + dy;
  while (f >= 0 && f <= 7 && r >= 1 && r <= 8) {
    const s = 'abcdefgh'.charAt(f) + String(r);
    if (sqs.has(s)) {
      hits.push(s);
      if (hits.length >= 2) break;
    }
    f += dx;
    r += dy;
  }
  return hits;
}

/** Squares along a ray up to and including the first blocker. */
function rayPath(sqs: Board['squares'], from: string, dx: number, dy: number): string[] {
  const path: string[] = [];
  let f = fileIdx(from) + dx;
  let r = rankIdx(from) + dy;
  while (f >= 0 && f <= 7 && r >= 1 && r <= 8) {
    const s = 'abcdefgh'.charAt(f) + String(r);
    path.push(s);
    if (sqs.has(s)) break;
    f += dx;
    r += dy;
  }
  return path;
}

/** "the king and the rook on a1". */
function listTargets(board: Board, squares: readonly string[]): string {
  const names = squares.map((sq) => {
    const p = board.squares.get(sq);
    return p && p.type === 'k' ? 'the king' : `the ${pieceName(p?.type ?? 'p')} on ${sq}`;
  });
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Detect the tactical motifs a move creates, strongest first.
 *
 * @param before  position before the move (side to move = the mover).
 * @param after   position after the move (produced by {@link applyUciMove}).
 * @param uci     the move, long algebraic.
 * @param engine  mate score + PV of the pre-move position.
 */
export function detectTactics(
  before: Board,
  after: Board,
  uci: string,
  engine: TacticEngineInfo,
): TacticFinding[] {
  const found = new Map<MotifId, TacticFinding>();
  const push = (
    id: MotifId,
    confidence: number,
    tier: ConfidenceTier,
    note: string,
    geometry?: { from?: string; targets?: readonly string[] },
  ) => {
    const ex = found.get(id);
    if (ex && confidence <= ex.confidence) return;
    found.set(id, { id, label: LABEL[id], confidence, tier, note, ...geometry });
  };

  try {
    const { from, to } = parseUciMove(uci);
    const mover = before.sideToMove;
    const enemy = otherColor(mover);
    const moved = after.squares.get(to);
    if (!moved) return [];
    const movedVal = PIECE_VALUES[moved.type];
    const movedName = pieceName(moved.type);
    const enemyKing = kingSquareOf(after, enemy);

    /** Can the mover win the enemy piece on `sq`? (king, or up-value, or undefended) */
    const winnable = (sq: string, attackerVal: number): boolean => {
      const q = after.squares.get(sq);
      if (!q || q.color !== enemy) return false;
      if (q.type === 'k') return true;
      if (PIECE_VALUES[q.type] > attackerVal) return true;
      return attackersOfSquares(after.squares, sq, enemy).length === 0;
    };

    // ── MATE / MATING NET (engine-confirmed) ──
    if (engine.mateIn !== null && engine.mateIn > 0) {
      if (engine.mateIn === 1) push('mate', 0.97, 'verified', 'it delivers checkmate');
      else if (engine.mateIn <= 5) push('mating-net', 0.8, 'verified', `it begins a forced mate in ${engine.mateIn}`);
    }

    // ── FORK ── the moved piece now hits two winnable enemy pieces
    const targets = attacksFrom(after.squares, to).filter((sq) => winnable(sq, movedVal));
    if (targets.length >= 2) {
      const royal = targets.some((sq) => after.squares.get(sq)?.type === 'k');
      push('fork', royal ? 0.95 : 0.9, 'verified', `the ${movedName} on ${to} attacks ${listTargets(after, targets)}`,
        { from: to, targets });
    }

    // ── PIN / SKEWER / X-RAY ── a mover slider sees two enemy pieces in a row
    for (const [s, p] of after.squares) {
      if (p.color !== mover || (p.type !== 'r' && p.type !== 'b' && p.type !== 'q')) continue;
      for (const [dx, dy] of slideDirs(p.type)) {
        const hits = rayHits(after.squares, s, dx, dy);
        if (hits.length < 2) continue;
        const h1 = hits[0]!, h2 = hits[1]!;
        const f1 = after.squares.get(h1)!, f2 = after.squares.get(h2)!;
        if (f1.color !== enemy || f2.color !== enemy) continue;
        const v1 = PIECE_VALUES[f1.type], v2 = PIECE_VALUES[f2.type];
        if (f2.type === 'k' || v2 > v1) {
          push('pin', f2.type === 'k' ? 0.92 : 0.82, 'verified',
            `the ${pieceName(p.type)} pins the ${pieceName(f1.type)} on ${h1} to the ${f2.type === 'k' ? 'king' : `${pieceName(f2.type)} on ${h2}`}`,
            { from: s, targets: [h1, h2] });
        } else if (f1.type === 'k' || v1 > v2) {
          push('skewer', 0.9, 'verified',
            `the ${pieceName(p.type)} skewers the ${f1.type === 'k' ? 'king' : `${pieceName(f1.type)} on ${h1}`}; when it steps aside the ${pieceName(f2.type)} on ${h2} falls`,
            { from: s, targets: [h1, h2] });
        }
        push('xray', 0.68, 'verified',
          `the ${pieceName(p.type)} on ${s} x-rays the ${pieceName(f1.type)} on ${h1} through to the ${pieceName(f2.type)} on ${h2}`,
          { from: s, targets: [h1, h2] });
      }
    }

    // ── DISCOVERED ATTACK / CHECK ── the vacated square unblocks a mover slider
    let discovered = 0;
    for (const [s, p] of after.squares) {
      if (p.color !== mover || s === to || (p.type !== 'r' && p.type !== 'b' && p.type !== 'q')) continue;
      for (const [dx, dy] of slideDirs(p.type)) {
        const path = rayPath(after.squares, s, dx, dy);
        if (!path.length || !path.includes(from)) continue;
        const last = path[path.length - 1]!;
        const tp = after.squares.get(last);
        if (!tp || tp.color !== enemy) continue;
        if (tp.type === 'k') {
          push('discovered-check', 0.95, 'verified', `moving the ${movedName} uncovers a check from the ${pieceName(p.type)} on ${s}`);
        } else {
          push('discovered-attack', 0.9, 'verified', `moving the ${movedName} uncovers the ${pieceName(p.type)} on ${s}, which now attacks the ${pieceName(tp.type)} on ${last}`);
          discovered++;
        }
      }
    }

    // ── DOUBLE ATTACK ── two separate threats in one move
    if (targets.length >= 1 && discovered >= 1) push('double-attack', 0.82, 'verified', 'the move makes two threats at once');
    else if (targets.length >= 2) push('double-attack', 0.72, 'verified', `the ${movedName} makes two threats at once`);

    // ── BACK RANK ── check by a heavy piece on the back rank, king boxed by its pawns
    if ((moved.type === 'r' || moved.type === 'q') && enemyKing && isInCheck(after, enemy)) {
      const backRank = enemy === 'white' ? 1 : 8;
      const fwd = enemy === 'white' ? 1 : -1;
      if (rankIdx(to) === backRank && rankIdx(enemyKing) === backRank) {
        const kf = fileIdx(enemyKing), kr = rankIdx(enemyKing);
        let boxed = true, any = false;
        for (const dfk of [-1, 0, 1]) {
          const s = squareAt(kf + dfk, kr + fwd);
          if (!s) continue;
          any = true;
          const occ = after.squares.get(s);
          if (!(occ && occ.color === enemy && occ.type === 'p')) boxed = false;
        }
        if (any && boxed) {
          push('back-rank', engine.mateIn === 1 ? 0.9 : 0.78, 'verified',
            `the ${pieceName(moved.type)} strikes the back rank, where the king is trapped behind its own pawns`);
        }
      }
    }

    // ── HEURISTICS (best-effort, low confidence) ──
    detectHeuristics(before, uci, engine, mover, enemy, push);
  } catch {
    // geometry is best-effort; a parse failure just yields no findings
  }

  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

/** Overloaded defender (from the pre-move board) + deflection/decoy (from the PV). */
function detectHeuristics(
  before: Board,
  uci: string,
  engine: TacticEngineInfo,
  mover: Board['sideToMove'],
  enemy: Board['sideToMove'],
  push: (id: MotifId, confidence: number, tier: ConfidenceTier, note: string) => void,
): void {
  const { to } = parseUciMove(uci);

  // Overloaded defender: capturing a piece whose only defender is also the only
  // guard of another piece the mover attacks.
  const captured = before.squares.get(to);
  if (captured && captured.color === enemy) {
    const defenders = attackersOfSquares(before.squares, to, enemy);
    if (defenders.length === 1) {
      const guard = defenders[0]!;
      for (const [sq, q] of before.squares) {
        if (q.color !== enemy || sq === to) continue;
        const guards = attackersOfSquares(before.squares, sq, enemy);
        if (guards.length === 1 && guards[0] === guard && attackersOfSquares(before.squares, sq, mover).length > 0) {
          push('overloaded', 0.5, 'heuristic',
            `the ${pieceName(captured.type)}'s only defender was also the sole guard of the ${pieceName(q.type)} on ${sq}`);
          break;
        }
      }
    }
  }

  // Deflection / decoy: read three plies of the PV. If the mover ends up winning
  // material (or a fork), and the line opened with a sacrifice (decoy) or a
  // check that drove a defender off (deflection), flag it — softly.
  const pv = engine.pv;
  if (pv.length >= 3 && pv.every((u) => /^[a-h][1-8][a-h][1-8][nbrq]?$/.test(u))) {
    let st = before;
    const tos: string[] = [];
    for (let k = 0; k < 3; k++) {
      st = applyUciMove(st, pv[k]!);
      tos.push(parseUciMove(pv[k]!).to);
    }
    if (tos.length === 3) {
      const sacFirst = tos[1] === tos[0]; // the reply recaptured on the mover's landing square
      const checkFirst = isInCheck(applyUciMove(before, pv[0]!), enemy);
      const landing = tos[2]!;
      const p3 = st.squares.get(landing);
      const wins = !!p3 && p3.color === mover &&
        attacksFrom(st.squares, landing).filter((sq) => {
          const q = st.squares.get(sq);
          return !!q && q.color === enemy && winsIn(st, sq, PIECE_VALUES[p3.type], enemy);
        }).length >= 2;
      if (wins && sacFirst) push('decoy', 0.45, 'heuristic', 'the move lures an enemy piece onto a square where the follow-up wins material');
      else if (wins && checkFirst) push('deflection', 0.45, 'heuristic', 'the move forces a defender away and collects material behind it');
    }
  }
}

/** Local "can win this piece" used inside the PV walk (its own board snapshot). */
function winsIn(board: Board, sq: string, attackerVal: number, enemy: Board['sideToMove']): boolean {
  const q = board.squares.get(sq);
  if (!q || q.color !== enemy) return false;
  if (q.type === 'k') return true;
  if (PIECE_VALUES[q.type] > attackerVal) return true;
  return attackersOfSquares(board.squares, sq, enemy).length === 0;
}
