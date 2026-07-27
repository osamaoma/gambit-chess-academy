/**
 * KingSafetyDetector — explains moves that leave the king in danger, and the
 * strategic consequences of doing so.
 *
 * It recognises:
 *  - MISSED CASTLING     — the engine wanted to castle; the played move didn't;
 *  - UNNECESSARY KING MOVE — a king step that throws away castling rights for no
 *                          forcing reason (not a capture, not out of check);
 *  - WEAKENED PAWN SHIELD — a pawn that shielded the king advanced or was lost;
 *  - OPEN FILE NEAR THE KING — the move opened a file on or beside the king;
 *  - EXPOSED / WEAKENED KING — the king simply ends up less safe (a composite
 *                          "danger" score that rises after the move).
 *
 * King safety is judged from a small, transparent model in {@link analyzeKingSafety}
 * (pawn shield, open files beside the king, enemy pieces bearing on the king
 * zone). Because a committal move can weaken the king yet still be objectively
 * best, the tier is `heuristic` — the classifier already restricts us to moves
 * it graded as slips, and any verified tactical/material detector outranks us.
 *
 * The explanations lead with the STRATEGIC CONSEQUENCE (open lines, lost tempo,
 * permanent weaknesses), which is where beginners lose games without noticing.
 */

import {
  attackersOf,
  Board,
  canCastle,
  isCaptureUci,
  isCastlingUci,
  kingOnHome,
  kingSquareOf,
  kingZone,
  otherColor,
  parseUciMove,
} from '../board';
import { boardsOf } from '../context';
import { Color } from '../types';
import { Explanation, Improvement, SignalDetector } from '../detector';
import { MoveClassification, MoveContext } from '../types';

/** A transparent snapshot of one side's king safety in a position. */
export interface KingSafety {
  readonly square: string;
  /** Files considered (king file ± 1, clamped to the board). */
  readonly shieldFiles: readonly string[];
  /** How many of those files hold a friendly pawn in the shield zone (0–3). */
  readonly shieldPresent: number;
  /** Files on/beside the king with NO friendly pawn — invasion routes. */
  readonly openFiles: readonly string[];
  /** Subset of {@link openFiles} with no pawn of either colour (fully open). */
  readonly fullyOpenFiles: readonly string[];
  /** Distinct enemy pieces attacking a square in the king zone. */
  readonly attackers: number;
  /** Composite danger score (higher = less safe). */
  readonly danger: number;
}

const A_CODE = 97;
const fileIdx = (square: string): number => square.charCodeAt(0) - A_CODE;
const fileLetter = (idx: number): string => String.fromCharCode(A_CODE + idx);
const squareAt = (file: number, rank: number): string | null =>
  file < 0 || file > 7 || rank < 1 || rank > 8 ? null : fileLetter(file) + String(rank);

/**
 * Analyse `color`'s king safety with a small, explainable model:
 *  - shield: a friendly pawn on the king's file (± 1) at its home rank or one
 *    square advanced still counts as shelter; pushed further, it stops counting;
 *  - open files: a king-adjacent file with no friendly pawn anywhere is a lane
 *    for enemy rooks/queen;
 *  - attackers: enemy pieces already hitting the 3×3 zone around the king.
 */
const EMPTY_SAFETY: KingSafety = {
  square: '', shieldFiles: [], shieldPresent: 0, openFiles: [], fullyOpenFiles: [], attackers: 0, danger: 0,
};

export function analyzeKingSafety(board: Board, color: Color): KingSafety {
  const square = kingSquareOf(board, color);
  if (!square) {
    return EMPTY_SAFETY;
  }
  const kf = fileIdx(square);
  const dir = color === 'white' ? 1 : -1;
  const homeRank = color === 'white' ? 2 : 7;
  const files = [kf - 1, kf, kf + 1].filter((f) => f >= 0 && f <= 7);

  let shieldPresent = 0;
  const openFiles: string[] = [];
  const fullyOpenFiles: string[] = [];
  for (const f of files) {
    // shield: friendly pawn directly in front of the king (home rank or one push)
    const shelter = [squareAt(f, homeRank), squareAt(f, homeRank + dir)].some((s) => {
      const p = s ? board.squares.get(s) : undefined;
      return !!p && p.color === color && p.type === 'p';
    });
    if (shelter) shieldPresent++;

    // open file: no friendly pawn anywhere on the file
    let friendlyPawn = false;
    let anyPawn = false;
    for (let r = 1; r <= 8; r++) {
      const p = board.squares.get(squareAt(f, r) as string);
      if (p && p.type === 'p') {
        anyPawn = true;
        if (p.color === color) friendlyPawn = true;
      }
    }
    if (!friendlyPawn) {
      openFiles.push(fileLetter(f));
      if (!anyPawn) fullyOpenFiles.push(fileLetter(f));
    }
  }

  const enemy = otherColor(color);
  const zoneAttackers = new Set<string>();
  for (const z of kingZone(square)) {
    for (const a of attackersOf(board, z, enemy)) zoneAttackers.add(a);
  }
  const attackers = zoneAttackers.size;

  const danger = openFiles.length * 2 + (files.length - shieldPresent) + attackers;
  return { square, shieldFiles: files.map(fileLetter), shieldPresent, openFiles, fullyOpenFiles, attackers, danger };
}

/** Everything the detector observed about one move — computed once. */
export interface KingSafetySignals {
  readonly before: KingSafety;
  readonly after: KingSafety;
  readonly missedCastling: boolean;
  readonly unnecessaryKingMove: boolean;
  readonly shieldWeakened: boolean;
  readonly fileOpened: boolean;
  readonly moreAttackers: boolean;
  /** Any degradation worth mentioning. */
  readonly weakened: boolean;
  /** File letter newly opened next to the king (for wording), or null. */
  readonly newOpenFile: string | null;
  readonly bestUci: string;
  readonly castleUci: string | null;
}

function castlesSafely(board: Board, uci: string): boolean {
  try {
    return isCastlingUci(board, uci);
  } catch {
    return false;
  }
}

/** Benign "king is fine" signals — used when the position can't be parsed. */
const NO_KS_SIGNAL = (bestUci: string): KingSafetySignals => ({
  before: EMPTY_SAFETY, after: EMPTY_SAFETY, missedCastling: false,
  unnecessaryKingMove: false, shieldWeakened: false, fileOpened: false,
  moreAttackers: false, weakened: false, newOpenFile: null, bestUci, castleUci: null,
});

/** Pure signal computation — exported for reuse and direct testing. */
export function computeKingSafetySignals(ctx: MoveContext): KingSafetySignals {
  const boards = boardsOf(ctx);
  if (!boards) return NO_KS_SIGNAL(ctx.evalBefore.uci);
  const b = boards.before;
  const a = boards.after;
  const color = ctx.mover;
  const before = analyzeKingSafety(b, color);
  const after = analyzeKingSafety(a, color);

  const move = parseUciMove(ctx.uci);
  const moved = b.squares.get(move.from);
  const isKingMove = moved?.type === 'k';
  const isCastle = castlesSafely(b, ctx.uci);
  const capture = isCaptureUci(b, ctx.uci);
  const kingInCheck = before.square ? attackersOf(b, before.square, otherColor(color)).length > 0 : false;

  const bestUci = ctx.evalBefore.uci;
  const bestIsCastle = castlesSafely(b, bestUci);
  const missedCastling = bestIsCastle && !isCastle && kingOnHome(b, color) && canCastle(b, color);

  const unnecessaryKingMove =
    !!isKingMove && !isCastle && canCastle(b, color) && !capture && !kingInCheck;

  const shieldWeakened = after.shieldPresent < before.shieldPresent;
  const beforeOpen = new Set(before.openFiles);
  const newOpen = after.openFiles.filter((f) => !beforeOpen.has(f));
  const fileOpened = newOpen.length > 0;
  const moreAttackers = after.attackers > before.attackers;

  const weakened =
    missedCastling ||
    unnecessaryKingMove ||
    shieldWeakened ||
    fileOpened ||
    (after.danger > before.danger && after.danger >= 2);

  return {
    before, after, missedCastling, unnecessaryKingMove, shieldWeakened, fileOpened,
    moreAttackers, weakened, newOpenFile: newOpen[0] ?? null,
    bestUci, castleUci: bestIsCastle ? bestUci : null,
  };
}

export class KingSafetyDetector extends SignalDetector<KingSafetySignals> {
  readonly id = 'king-safety';
  readonly tier = 'heuristic' as const;
  /** Above generic development: king safety is the more consequential principle. */
  override readonly priority = 8;
  /** King-safety slips read as slow/positional errors, not tactical blunders. */
  override readonly classifications: readonly MoveClassification[] = ['inaccuracy', 'mistake'];

  protected computeSignals(ctx: MoveContext): KingSafetySignals {
    return computeKingSafetySignals(ctx);
  }

  protected appliesTo(ctx: MoveContext): boolean {
    return this.signals(ctx).weakened;
  }

  protected confidence(ctx: MoveContext): number {
    const s = this.signals(ctx);
    let c = 0.3;
    if (s.missedCastling) c = Math.max(c, 0.6);
    if (s.unnecessaryKingMove) c = Math.max(c, 0.65);
    if (s.fileOpened) c += 0.2;
    if (s.shieldWeakened) c += 0.15;
    if (s.moreAttackers) c += 0.15;
    return Math.min(c, 0.85); // heuristics stay humble
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const tags = ['king-safety'];
    let headline: string;
    const parts: string[] = [];

    if (s.missedCastling) {
      tags.push('castling');
      headline = `${ctx.san} leaves the king in the centre.`;
      parts.push(
        'Castling was available and best. A king in the centre is exposed to checks and tactics down the open lines, and your rooks stay disconnected — so your attack is a piece short while your defence is a king short.',
      );
    } else if (s.unnecessaryKingMove) {
      tags.push('castling');
      headline = `${ctx.san} gives up castling for nothing.`;
      parts.push(
        'Moving the king throws away the right to castle for the rest of the game. Now the king can only crawl to safety by hand, every future check costs you a tempo, and the rooks may never connect.',
      );
    } else if (s.fileOpened && s.newOpenFile) {
      tags.push('open-file');
      headline = `${ctx.san} opens the ${s.newOpenFile}-file next to your king.`;
      parts.push(
        `An open file beside the king is a highway for enemy rooks and the queen — the classic way an attack crashes through. The pawn that guarded the ${s.newOpenFile}-file is gone and can't come back, so that lane is a permanent worry.`,
      );
    } else if (s.shieldWeakened) {
      tags.push('pawn-shield');
      headline = `${ctx.san} weakens the pawns in front of your king.`;
      parts.push(
        'The pawns sheltering the king have advanced, and pawns never move backwards. The squares they vacate become permanent holes for enemy pieces to occupy, and the king has less cover when the attack comes.',
      );
    } else {
      headline = `${ctx.san} leaves your king more exposed.`;
      parts.push(
        'After this move the king has fewer defenders and more open lines around it. King safety is not something you fix later — bring pieces back now, or the opponent will arrive first.',
      );
    }

    if (s.after.openFiles.length > 0 && !s.fileOpened) {
      parts.push(`The ${listFiles(s.after.openFiles)} beside your king ${s.after.openFiles.length === 1 ? 'is' : 'are'} already without a pawn — keep enemy heavy pieces off ${s.after.openFiles.length === 1 ? 'it' : 'them'}.`);
    }
    return { headline, detail: parts.join(' '), tags };
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    if (s.castleUci) {
      tips.push({ moveUci: s.castleUci, advice: 'Castle — get the king to safety before starting anything else.' });
    } else if (s.unnecessaryKingMove) {
      tips.push({ advice: 'Keep the king home and castle instead; only move the king by hand when you are forced to.' });
    }
    tips.push({
      advice:
        'King-safety habits: castle by move 10, leave the three pawns in front of your king unmoved, and never open a file next to your own king unless you are the one attacking.',
    });
    return tips;
  }
}

/** "d- and f-files" / "e-file" — natural-language file list. */
function listFiles(files: readonly string[]): string {
  const named = files.map((f) => `${f}-file`);
  if (named.length <= 1) return named[0] ?? '';
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}
