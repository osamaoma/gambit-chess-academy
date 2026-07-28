/**
 * Module 2 — ThemeDetector.
 *
 * Names the STRATEGIC ideas a move touches: development, king safety, central
 * control, activity, structure. Where the motif detector answers "what tactic
 * is here?", this answers "what is this move about?".
 *
 * Extensibility is the point of the design. A theme is a small pure function
 * ({@link ThemeRule}); adding one means writing a function and passing it in.
 * No existing rule changes, and the detector itself never grows.
 */

import {
  applyUciMove,
  CENTER_SQUARES,
  fileIndex,
  isCastlingUci,
  isDevelopingUci,
  isHomeSquare,
  isOpenFile,
  parseUciMove,
  pieceMobility,
} from '@gambit/explanation-engine';
import type { Board } from '@gambit/explanation-engine';
import type { PositionContext, ReviewInput, Theme, ThemeDetector } from './types';

/** Everything a theme rule may inspect. Derived once by the detector. */
export interface ThemeContext {
  readonly input: ReviewInput;
  readonly position: PositionContext;
  readonly before: Board;
  readonly after: Board;
  readonly from: string;
  readonly to: string;
  /** Piece type that moved ('n', 'b', 'r', 'q', 'k', 'p'). */
  readonly piece: string;
  readonly mobilityBefore: number;
  readonly mobilityAfter: number;
}

/** A rule returns a theme when it applies, or null. Pure and independent. */
export type ThemeRule = (ctx: ThemeContext) => Theme | null;

const theme = (id: string, label: string, weight: number, squares?: readonly string[]): Theme =>
  ({ id, label, weight, ...(squares ? { squares } : {}) });

/* ────────────────────────────── the standard rules ─────────────────────────── */

/** A piece leaves its starting square for the first time. */
export const developmentRule: ThemeRule = (c) => {
  if (c.piece === 'p' || c.piece === 'k') return null;
  if (!isHomeSquare(c.before.sideToMove, c.piece as never, c.from)) return null;
  let develops = false;
  try { develops = isDevelopingUci(c.before, c.input.analysis.playedMove); } catch { develops = false; }
  return develops ? theme('development', 'Development', 0.85, [c.to]) : null;
};

/** Castling, or a king move that gives the right up. */
export const kingSafetyRule: ThemeRule = (c) => {
  let castles = false;
  try { castles = isCastlingUci(c.before, c.input.analysis.playedMove); } catch { castles = false; }
  if (castles) return theme('king-safety', 'King safety', 0.95, [c.to]);
  if (c.piece === 'k') return theme('king-safety', 'King safety', 0.6, [c.to]);
  return null;
};

/** A pawn occupies or strikes at the four central squares. */
export const centralControlRule: ThemeRule = (c) => {
  if (c.piece !== 'p') return null;
  const centre = CENTER_SQUARES as readonly string[];
  if (centre.includes(c.to)) return theme('central-control', 'Central control', 0.9, [c.to]);
  // A pawn one rank away that attacks a central square is a lever.
  const hits = centre.filter((sq) => Math.abs(fileIndex(sq) - fileIndex(c.to)) === 1);
  return hits.length > 0 && Math.abs(rank(c.to) - 4.5) <= 1.5
    ? theme('central-control', 'Central control', 0.6, hits)
    : null;
};

/** The piece gains a lot of scope. */
export const activityRule: ThemeRule = (c) => {
  if (c.piece === 'p' || c.piece === 'k') return null;
  const gain = c.mobilityAfter - c.mobilityBefore;
  if (gain < 3 || c.mobilityAfter < 6) return null;
  return theme('piece-activity', 'Piece activity', Math.min(1, 0.5 + gain / 12), [c.to]);
};

/** A rook (or queen) lands on a file with no pawns at all. */
export const openFileRule: ThemeRule = (c) => {
  if (c.piece !== 'r' && c.piece !== 'q') return null;
  return isOpenFile(c.after, fileIndex(c.to))
    ? theme('open-file', 'Open file', 0.8, [c.to])
    : null;
};

/** The move changes the material balance. */
export const materialRule: ThemeRule = (c) => {
  const captured = c.before.squares.get(c.to);
  return captured && captured.color !== c.before.sideToMove
    ? theme('material', 'Material', 0.7, [c.to])
    : null;
};

export const DEFAULT_THEME_RULES: readonly ThemeRule[] = [
  developmentRule,
  kingSafetyRule,
  centralControlRule,
  activityRule,
  openFileRule,
  materialRule,
];

/* ────────────────────────────── the detector ───────────────────────────────── */

export class DefaultThemeDetector implements ThemeDetector {
  constructor(private readonly rules: readonly ThemeRule[] = DEFAULT_THEME_RULES) {}

  detect(input: ReviewInput, position: PositionContext): readonly Theme[] {
    let from: string;
    let to: string;
    try {
      ({ from, to } = parseUciMove(input.analysis.playedMove));
    } catch {
      return [];
    }
    const before = input.boards.before;
    const moved = before.squares.get(from);
    if (!moved) return [];

    let after: Board;
    try { after = applyUciMove(before, input.analysis.playedMove); } catch { after = input.boards.after; }

    const ctx: ThemeContext = {
      input, position, before, after, from, to,
      piece: moved.type,
      mobilityBefore: safeMobility(before, from),
      mobilityAfter: safeMobility(after, to),
    };

    const themes: Theme[] = [];
    for (const rule of this.rules) {
      // One broken rule must not cost the whole review its themes.
      try {
        const t = rule(ctx);
        if (t) themes.push(t);
      } catch { /* skip */ }
    }
    return themes.sort((a, b) => b.weight - a.weight);
  }
}

const rank = (sq: string): number => Number(sq[1] ?? 0);
const safeMobility = (b: Board, sq: string): number => {
  try { return pieceMobility(b, sq); } catch { return 0; }
};
