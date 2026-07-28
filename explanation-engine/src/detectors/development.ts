/**
 * DevelopmentDetector — the first concrete detector.
 *
 * Explains opening moves that ignore development principles. It recognises:
 *  - the game is still in the OPENING (early ply + development unfinished);
 *  - the engine's BEST move develops a piece (or castles);
 *  - the PLAYED move fails to develop (no new piece out, no capture, no castle);
 *  - the played move WASTES A TEMPO (re-moves an already-developed piece while
 *    others wait at home);
 *  - the player DELAYS CASTLING (king in the centre, rights intact, late in
 *    the opening).
 *
 * Tier: `heuristic` — every individual fact is read straight off the FEN, but
 * the INFERENCE ("this move is bad *because* of development") can be wrong:
 * a move may be poor for tactical reasons while the best move happens to
 * develop. Per the architecture rules, a method that can be wrong is heuristic,
 * so verified tactical detectors will always outrank this one.
 */

import {
  Board,
  canCastle,
  describePiece,
  isCaptureUci,
  isCastlingUci,
  isDevelopingUci,
  isHomeSquare,
  kingOnHome,
  parseUciMove,
  undevelopedMinors,
} from '../board';
import { boardsOf } from '../context';
import { ArrowHint, Explanation, Improvement, SignalDetector, SquareHint, Visuals } from '../detector';
import { movers } from '../perspective';
import { MoveClassification, MoveContext } from '../types';

/** Tunable thresholds — override via the constructor for different play pools. */
export interface DevelopmentDetectorConfig {
  /** Latest ply still considered "the opening" (24 = through move 12). */
  readonly openingMaxPly: number;
  /** From this ply on, an uncastled king starts to count against quiet moves (13 ≈ move 7). */
  readonly castleUrgencyPly: number;
}

export const DEFAULT_DEVELOPMENT_CONFIG: DevelopmentDetectorConfig = {
  openingMaxPly: 24,
  castleUrgencyPly: 13,
};

/** Everything the detector observed about one move — computed once, shared by all hooks. */
export interface DevelopmentSignals {
  readonly inOpening: boolean;
  readonly playedFailsToDevelop: boolean;
  readonly wastesTempo: boolean;
  readonly delaysCastling: boolean;
  readonly bestDevelops: boolean;
  readonly bestIsCastle: boolean;
  /** "knight on g1" for the best move's piece (null when best doesn't develop). */
  readonly bestDescription: string | null;
  readonly bestUci: string;
  /** Home squares where the mover's minors still sit. */
  readonly undeveloped: readonly string[];
}

/** Benign "nothing to say" signals — used when the position can't be parsed. */
const NO_DEV_SIGNAL = (bestUci: string): DevelopmentSignals => ({
  inOpening: false, playedFailsToDevelop: false, wastesTempo: false,
  delaysCastling: false, bestDevelops: false, bestIsCastle: false,
  bestDescription: null, bestUci, undeveloped: [],
});

/**
 * Pure signal computation — exported so future detectors (or tests) can reuse
 * the same opening/development reasoning without instantiating the detector.
 */
export function computeDevelopmentSignals(
  ctx: MoveContext,
  cfg: DevelopmentDetectorConfig = DEFAULT_DEVELOPMENT_CONFIG,
): DevelopmentSignals {
  const boards = boardsOf(ctx);
  if (!boards) return NO_DEV_SIGNAL(ctx.evalBefore.uci);
  const board = boards.before;
  const color = ctx.mover;

  const undeveloped = undevelopedMinors(board, color);
  const kingHome = kingOnHome(board, color);
  const rights = canCastle(board, color);

  // "Still in the opening": early enough AND development genuinely unfinished.
  const inOpening =
    ctx.ply <= cfg.openingMaxPly && (undeveloped.length > 0 || (kingHome && rights));

  const playedCaptures = isCaptureUci(board, ctx.uci);
  const playedDevelops = isDevelopingUci(board, ctx.uci);
  // Captures are concrete business, not a development failure.
  const playedFailsToDevelop = !playedDevelops && !playedCaptures;

  // Tempo waste: re-moving a piece that already left home (quietly), while
  // teammates still wait on their starting squares.
  const played = parseUciMove(ctx.uci);
  const movedPiece = board.squares.get(played.from);
  const wastesTempo =
    !!movedPiece &&
    movedPiece.type !== 'p' &&
    !playedCaptures &&
    !isCastlingUci(board, ctx.uci) &&
    !isHomeSquare(color, movedPiece.type, played.from) &&
    undeveloped.length > 0;

  const delaysCastling =
    kingHome && rights && ctx.ply >= cfg.castleUrgencyPly && !isCastlingUci(board, ctx.uci);

  const bestUci = ctx.evalBefore.uci;
  const bestDevelops = safeIsDeveloping(board, bestUci);
  const bestIsCastle = bestDevelops && safeIsCastling(board, bestUci);
  const bestDescription = bestDevelops
    ? bestIsCastle
      ? 'castling'
      : describePiece(board, parseUciMove(bestUci).from)
    : null;

  return {
    inOpening,
    playedFailsToDevelop,
    wastesTempo,
    delaysCastling,
    bestDevelops,
    bestIsCastle,
    bestDescription,
    bestUci,
    undeveloped,
  };
}

export class DevelopmentDetector extends SignalDetector<DevelopmentSignals> {
  readonly id = 'development';
  readonly tier = 'heuristic' as const;
  /** Modest: principle talk should defer to concrete same-tier pattern detectors. */
  override readonly priority = 5;
  /** Blunders usually have tactical causes; book moves need no lecture. */
  override readonly classifications: readonly MoveClassification[] = [
    'inaccuracy',
    'mistake',
    'good',
  ];

  private readonly cfg: DevelopmentDetectorConfig;

  constructor(cfg: Partial<DevelopmentDetectorConfig> = {}) {
    super();
    this.cfg = { ...DEFAULT_DEVELOPMENT_CONFIG, ...cfg };
  }

  protected computeSignals(ctx: MoveContext): DevelopmentSignals {
    return computeDevelopmentSignals(ctx, this.cfg);
  }

  protected appliesTo(ctx: MoveContext): boolean {
    const s = this.signals(ctx);
    return (
      s.inOpening &&
      s.playedFailsToDevelop &&
      (s.bestDevelops || s.wastesTempo || s.delaysCastling)
    );
  }

  protected confidence(ctx: MoveContext): number {
    const s = this.signals(ctx);
    let c = 0.35;                                         // base: principle inference
    if (s.bestDevelops) c += 0.25;                        // the engine agrees development was on
    if (s.wastesTempo) c += 0.2;                          // clearest principle violation
    if (s.delaysCastling) c += 0.1;
    c += Math.min(0.1, 0.05 * Math.max(0, s.undeveloped.length - 1)); // more laggards, clearer case
    return Math.min(c, 0.9);                              // heuristics stay humble
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const board = boardsOf(ctx)!.before; // appliesTo already proved the position parses

    const headline = s.wastesTempo
      ? `${ctx.san} loses a tempo in the opening.`
      : s.bestIsCastle
        ? `${ctx.san} postpones castling.`
        : s.bestDevelops
          ? `${ctx.san} misses a chance to develop.`
          : `${ctx.san} leaves the king in the centre.`;

    const parts: string[] = [];
    if (s.wastesTempo) {
      parts.push(
        'This piece had already left its home square — moving it again without a concrete gain spends a tempo the opening rarely refunds.',
      );
    } else {
      parts.push(`${ctx.san} neither brings a new piece into play nor changes the structure with a capture.`);
    }
    if (s.undeveloped.length > 0) {
      parts.push(`You still have the ${listPieces(board, s.undeveloped)} waiting at home.`);
    }
    if (s.bestDevelops) {
      parts.push(
        s.bestIsCastle
          ? 'The engine preferred castling: the king reaches safety and the rooks finally join the game.'
          : `The engine preferred developing the ${s.bestDescription}, following the classical rule — every minor piece out before repeat moves.`,
      );
    }
    if (s.delaysCastling) {
      parts.push(
        'Your king is still in the centre with castling available; each quiet move that is not castling leaves it exposed a move longer.',
      );
    }

    const tags = ['opening-principles', 'development'];
    if (s.wastesTempo) tags.push('tempo');
    if (s.delaysCastling || s.bestIsCastle) tags.push('castling');

    const My = movers(ctx);
    const summary = s.wastesTempo
      ? `${ctx.san} moves an already-developed piece again while ${listPieces(board, s.undeveloped)} still sit at home.`
      : s.bestIsCastle
        ? `Castling was the move — ${My.toLowerCase()} king stays in the centre and the rooks stay disconnected.`
        : s.bestDevelops
          ? `${ctx.san} develops nothing; the engine wanted the ${s.bestDescription} brought into play.`
          : `${My} king is still in the centre with castling available.`;

    return { headline, summary, detail: parts.join(' '), tags, visuals: this.visualsFor(s) };
  }

  /** Show the engine's developing move, and mark the pieces still at home. */
  private visualsFor(s: DevelopmentSignals): Visuals {
    const arrows: ArrowHint[] = [];
    const squares: SquareHint[] = [];
    if (s.bestDevelops && s.bestUci.length >= 4) {
      arrows.push({ from: s.bestUci.slice(0, 2), to: s.bestUci.slice(2, 4), color: 'best' });
    }
    for (const sq of s.undeveloped) squares.push({ square: sq, color: 'danger' });
    return { arrows, squares };
  }

  /** The coaching tips. */
  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    if (s.bestDevelops) {
      tips.push({
        moveUci: s.bestUci,
        advice: s.bestIsCastle
          ? 'Castle here — king safety first; concrete plans come after.'
          : `Develop the ${s.bestDescription} instead — new pieces before second moves.`,
      });
    }
    tips.push({
      advice:
        'Opening habit: develop each knight and bishop once, castle by move 10, and avoid moving the same piece twice before development is finished.',
    });
    return tips;
  }
}

/* ────────────────────────── module-private helpers ────────────────────────── */

/** UCI strings from the engine should always parse — but never trust, never throw. */
function safeIsDeveloping(board: Board, uci: string): boolean {
  try {
    return isDevelopingUci(board, uci);
  } catch {
    return false;
  }
}

function safeIsCastling(board: Board, uci: string): boolean {
  try {
    return isCastlingUci(board, uci);
  } catch {
    return false;
  }
}

/** "knight on b1 and bishop on c1" — natural-language list. */
function listPieces(board: Board, squares: readonly string[]): string {
  const names = squares.map((sq) => describePiece(board, sq));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
