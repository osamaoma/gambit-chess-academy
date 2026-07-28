/**
 * Minimal board reading and attack geometry.
 *
 * Deliberately self-contained rather than importing the explanation engine:
 * classification is stage 3 and explanation is stage 4, so depending on the
 * later stage would invert the pipeline. This is the smallest amount of chess
 * geometry the classifier genuinely needs.
 *
 * It exists for ONE reason: telling a sacrifice from a blunder. A sacrifice
 * cannot be measured by diffing material across the move, because the material
 * is not lost until the OPPONENT replies — a queen sacrifice looks perfectly
 * even until it is accepted. What actually identifies one is that the move
 * leaves material hanging that the opponent can win with something cheaper.
 */

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'white' | 'black';

export interface Piece { readonly color: Color; readonly type: PieceType }
export type Squares = ReadonlyMap<string, Piece>;

export const PIECE_CP: Readonly<Record<PieceType, number>> = {
  p: 100, n: 300, b: 320, r: 500, q: 900, k: 0,
};

const FILES = 'abcdefgh';

export const squareAt = (file: number, rank: number): string | null =>
  file < 0 || file > 7 || rank < 1 || rank > 8 ? null : FILES[file]! + rank;

export const fileOf = (sq: string): number => sq.charCodeAt(0) - 97;
export const rankOf = (sq: string): number => Number(sq[1]);

/** Read the piece placement field of a FEN. Throws on malformed input. */
export function parseBoard(fen: string): Squares {
  const placement = (fen ?? '').split(/\s+/)[0];
  if (!placement) throw new Error('Malformed FEN.');
  const squares = new Map<string, Piece>();
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('Malformed FEN: expected 8 ranks.');

  rows.forEach((row, index) => {
    const rank = 8 - index;
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
      const type = ch.toLowerCase() as PieceType;
      if (!'pnbrqk'.includes(type)) throw new Error(`Malformed FEN: piece "${ch}".`);
      const sq = squareAt(file, rank);
      if (sq) squares.set(sq, { color: ch === ch.toUpperCase() ? 'white' : 'black', type });
      file++;
    }
  });
  return squares;
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const DIAGONAL = [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const;
const STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Squares the piece on `from` attacks.
 *
 * Attacks, not legal moves: a pinned piece still defends, and pawn pushes are
 * not attacks. That is the right notion for "can this be captured?".
 */
export function attacksFrom(squares: Squares, from: string): string[] {
  const piece = squares.get(from);
  if (!piece) return [];
  const f = fileOf(from);
  const r = rankOf(from);
  const out: string[] = [];

  const ray = (steps: readonly (readonly [number, number])[]): void => {
    for (const [df, dr] of steps) {
      for (let i = 1; i < 8; i++) {
        const sq = squareAt(f + df * i, r + dr * i);
        if (!sq) break;
        out.push(sq);
        if (squares.has(sq)) break;      // blocked, but the blocker is attacked
      }
    }
  };
  const hop = (steps: readonly (readonly [number, number])[]): void => {
    for (const [df, dr] of steps) {
      const sq = squareAt(f + df, r + dr);
      if (sq) out.push(sq);
    }
  };

  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'white' ? 1 : -1;
      for (const df of [-1, 1]) {
        const sq = squareAt(f + df, r + dir);
        if (sq) out.push(sq);
      }
      break;
    }
    case 'n': hop(KNIGHT); break;
    case 'k': hop([...DIAGONAL, ...STRAIGHT]); break;
    case 'b': ray(DIAGONAL); break;
    case 'r': ray(STRAIGHT); break;
    case 'q': ray([...DIAGONAL, ...STRAIGHT]); break;
  }
  return out;
}

/**
 * The best material the opponent can win by capturing something of `mover`'s
 * with a CHEAPER piece — the signature of an offer.
 *
 * Returns the largest (victim − attacker) value found, or 0 when nothing is on
 * offer. Mirrors the test the live app already uses, which is the correct one.
 */
export function offeredMaterial(squares: Squares, mover: Color): number {
  const opponent: Color = mover === 'white' ? 'black' : 'white';
  let best = 0;
  for (const [from, piece] of squares) {
    if (piece.color !== opponent) continue;
    // The king is never a "cheaper attacker": it has no material value, so a
    // king capture would score as a full-value win against every piece on the
    // board. Taking with the king means the target was simply undefended,
    // which is a hanging piece — a different idea, handled by other rules.
    if (piece.type === 'k') continue;
    const attackerValue = PIECE_CP[piece.type];
    for (const target of attacksFrom(squares, from)) {
      const victim = squares.get(target);
      if (!victim || victim.color !== mover || victim.type === 'k') continue;
      const gain = PIECE_CP[victim.type] - attackerValue;
      if (gain > best) best = gain;
    }
  }
  return best;
}

/** Total material for one colour, kings excluded. */
export function materialFor(squares: Squares, color: Color): number {
  let total = 0;
  for (const piece of squares.values()) {
    if (piece.color === color) total += PIECE_CP[piece.type];
  }
  return total;
}
