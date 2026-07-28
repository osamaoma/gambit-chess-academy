/**
 * PieceActivityDetector — the positional voice.
 *
 * It reads a move through the lens of piece activity and explains the strategic
 * consequence, praising a strong move or flagging a passive one:
 *  - `rook-open-file`  — a rook swings onto an open / half-open file;
 *  - `knight-outpost`  — a knight lands on a protected, unassailable square;
 *  - `strong-bishop`   — a bishop reaches a long, open diagonal;
 *  - `connected-rooks` — the rooks link up (a coordination milestone);
 *  - `activated`       — the moved piece's mobility jumps sharply;
 *  - `passive-piece`   — the move parks a piece on a low-activity square;
 *  - `bad-bishop`      — a pawn move walls a bishop in behind its own pawns;
 *  - `missed-activity` — the engine's move activated a piece and this one didn't.
 *
 * Tier `heuristic`: the facts are read off the board, but "the move was good/bad
 * BECAUSE of activity" is a positional inference that a concrete tactic or
 * material swing can override — which the selector guarantees, since verified
 * detectors (tactics 30, material 22, hanging 20) all outrank this one.
 *
 * Praise fires only on strong classifications; criticism only on flawed ones —
 * so the detector never scolds a good move or flatters a mistake.
 */

import {
  applyUciMove,
  attacks,
  Board,
  fileIndex,
  isHomeSquare,
  parseUciMove,
  pieceName,
  squareColor,
} from '../board';
import {
  bishopQuality,
  CENTER_SQUARES,
  isOpenFile,
  isOutpostSquare,
  isSemiOpenFile,
  outpostSupported,
  pieceMobility,
  rooksConnected,
} from '../positional';
import { CRITIQUE_CLASSES, POSITIONAL_CLASSES, PRAISE_CLASSES } from '../classifications';
import { boardsOf } from '../context';
import { ArrowHint, Explanation, Improvement, SignalDetector, SquareHint, Visuals } from '../detector';
import { movers, moversLower } from '../perspective';
import { joinList } from '../text';
import { MoveClassification, MoveContext } from '../types';

type ActivityKind =
  | 'rook-open-file'
  | 'knight-outpost'
  | 'strong-bishop'
  | 'connected-rooks'
  | 'developed'
  | 'activated'
  | 'passive-piece'
  | 'bad-bishop'
  | 'missed-activity';

const PRAISE_KINDS: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  'rook-open-file',
  'knight-outpost',
  'strong-bishop',
  'connected-rooks',
  'developed',
  'activated',
]);

export interface ActivitySignals {
  readonly kind: ActivityKind | null;
  readonly pieceType: string;       // piece name of the moved piece ("rook")
  readonly from: string;
  readonly to: string;
  readonly mobilityBefore: number;
  readonly mobilityAfter: number;
  /** Central squares the moved piece now attacks (for "supporting the centre"). */
  readonly centerSupport: readonly string[];
  /** The file the moved piece landed on, as a letter (for rook-open-file). */
  readonly fileLetter: string;
  /** For missed-activity: a clause describing the engine's activating move. */
  readonly bestActivation: string | null;
  readonly bestUci: string;
}

const NO_SIGNAL = (bestUci: string): ActivitySignals => ({
  kind: null, pieceType: '', from: '', to: '', mobilityBefore: 0, mobilityAfter: 0,
  centerSupport: [], fileLetter: '', bestActivation: null, bestUci,
});

const fileLetter = (i: number): string => 'abcdefgh'.charAt(i);

/** Describe how a move improves a piece's activity, or null if it doesn't. */
function activationOf(before: Board, uci: string): string | null {
  let after: Board;
  let to: string;
  let from: string;
  try {
    ({ from, to } = parseUciMove(uci));
    after = applyUciMove(before, uci);
  } catch {
    return null;
  }
  const piece = after.squares.get(to);
  if (!piece) return null;
  const color = before.sideToMove;

  if (piece.type === 'r') {
    const df = fileIndex(to);
    const nowOpen = isOpenFile(after, df) || isSemiOpenFile(after, df, color);
    const wasOpen = isOpenFile(before, fileIndex(from)) || isSemiOpenFile(before, fileIndex(from), color);
    if (nowOpen && !wasOpen) return `puts the rook on the open ${fileLetter(df)}-file`;
  }
  if (piece.type === 'n' && isOutpostSquare(after, to, color) && outpostSupported(after, to, color)) {
    return `plants a knight on the outpost ${to}`;
  }
  const gain = pieceMobility(after, to) - pieceMobility(before, from);
  if ('nbrq'.includes(piece.type) && gain >= 4 && pieceMobility(after, to) >= 6) {
    return `swings the ${pieceName(piece.type)} to a far more active square`;
  }
  return null;
}

/** Pure signal computation — exported for reuse and direct testing. */
export function computeActivitySignals(ctx: MoveContext): ActivitySignals {
  const bestUci = ctx.evalBefore.uci;
  const boards = boardsOf(ctx);
  if (!boards) return NO_SIGNAL(bestUci);
  const { before, after } = boards;
  let from: string;
  let to: string;
  try {
    ({ from, to } = parseUciMove(ctx.uci));
  } catch {
    return NO_SIGNAL(bestUci);
  }

  const moved = after.squares.get(to);
  if (!moved) return NO_SIGNAL(bestUci);
  const color = ctx.mover;
  const mobilityBefore = pieceMobility(before, from);
  const mobilityAfter = pieceMobility(after, to);
  const hits = attacks(after, to);
  const centerSupport = (CENTER_SQUARES as readonly string[]).filter((sq) => hits.includes(sq));
  const base = {
    pieceType: pieceName(moved.type), from, to, mobilityBefore, mobilityAfter,
    centerSupport, fileLetter: fileLetter(fileIndex(to)), bestUci,
  };

  const praise = PRAISE_CLASSES.has(ctx.classification);
  const critique = CRITIQUE_CLASSES.has(ctx.classification);

  if (praise) {
    // most specific / valuable first
    if (moved.type === 'n' && isOutpostSquare(after, to, color) && outpostSupported(after, to, color)) {
      return { ...base, kind: 'knight-outpost', bestActivation: null };
    }
    if (moved.type === 'r') {
      const df = fileIndex(to);
      const nowOpen = isOpenFile(after, df) || isSemiOpenFile(after, df, color);
      const wasOpen = isOpenFile(before, fileIndex(from)) || isSemiOpenFile(before, fileIndex(from), color);
      if (nowOpen && !wasOpen) return { ...base, kind: 'rook-open-file', bestActivation: null };
    }
    if (moved.type === 'b' && bishopQuality(after, to) === 'good') {
      return { ...base, kind: 'strong-bishop', bestActivation: null };
    }
    if (rooksConnected(after, color) && !rooksConnected(before, color)) {
      return { ...base, kind: 'connected-rooks', bestActivation: null };
    }
    // A minor piece leaving its starting square is the most common "good move"
    // in the opening — and the one a review must be able to explain.
    if ('nb'.includes(moved.type) && isHomeSquare(color, moved.type, from) && !isHomeSquare(color, moved.type, to)) {
      return { ...base, kind: 'developed', bestActivation: null };
    }
    if ('nbrq'.includes(moved.type) && mobilityAfter - mobilityBefore >= 4 && mobilityAfter >= 6) {
      return { ...base, kind: 'activated', bestActivation: null };
    }
    return NO_SIGNAL(bestUci);
  }

  if (critique) {
    // a pawn move that walls in one of the mover's bishops
    if (moved.type === 'p') {
      for (const [sq, p] of after.squares) {
        if (p.color === color && p.type === 'b' && squareColor(sq) === squareColor(to) && bishopQuality(after, sq) === 'bad') {
          return { ...base, kind: 'bad-bishop', bestActivation: null };
        }
      }
    }
    if ('nbrq'.includes(moved.type) && mobilityAfter <= 3 && mobilityAfter < mobilityBefore) {
      return { ...base, kind: 'passive-piece', bestActivation: null };
    }
    const bestActivation = ctx.uci.slice(0, 4) !== bestUci.slice(0, 4) ? activationOf(before, bestUci) : null;
    if (bestActivation && activationOf(before, ctx.uci) === null) {
      return { ...base, kind: 'missed-activity', bestActivation };
    }
  }

  return NO_SIGNAL(bestUci);
}

export class PieceActivityDetector extends SignalDetector<ActivitySignals> {
  readonly id = 'piece-activity';
  readonly tier = 'heuristic' as const;
  override readonly priority = 7;
  override readonly classifications: readonly MoveClassification[] = POSITIONAL_CLASSES;

  protected computeSignals(ctx: MoveContext): ActivitySignals {
    return computeActivitySignals(ctx);
  }

  protected appliesTo(ctx: MoveContext): boolean {
    return this.signals(ctx).kind !== null;
  }

  protected confidence(ctx: MoveContext): number {
    const kind = this.signals(ctx).kind;
    switch (kind) {
      case 'knight-outpost': return 0.72;
      case 'bad-bishop': return 0.62;
      case 'rook-open-file': return 0.7;
      case 'passive-piece': return 0.6;
      case 'missed-activity': return 0.6;
      case 'strong-bishop': return 0.6;
      case 'activated': return 0.55;
      case 'connected-rooks': return 0.5;
      case 'developed': return 0.45;   // true and useful, but the least "special" idea
      default: return 0;
    }
  }

  protected explain(ctx: MoveContext): Omit<Explanation, 'improvements'> {
    const s = this.signals(ctx);
    const san = ctx.san;
    const piece = s.pieceType;
    const tags = ['positional', 'piece-activity', s.kind as string];
    const My = movers(ctx);
    const my = moversLower(ctx);
    const visuals = this.visualsFor(s);
    const supports = s.centerSupport.length
      ? `, supporting ${joinList([...s.centerSupport])} in the centre`
      : '';

    switch (s.kind) {
      case 'rook-open-file':
        return { headline: `${san} seizes the open file.`, tags, visuals,
          summary: `${My} rook takes the open ${s.fileLetter}-file from ${s.to}, where it rakes the board with nothing in its way.`,
          detail: `An open file is a rook's highway. On ${s.to} the rook rakes down the board, ready to invade the seventh rank and tie the enemy to passive defence — rooks belong on open and half-open files.` };
      case 'knight-outpost':
        return { headline: `${san} lands a knight on an outpost.`, tags, visuals,
          summary: `${My} knight settles on ${s.to}, a protected square no enemy pawn can ever chase it from.`,
          detail: `The knight on ${s.to} sits on a protected square no enemy pawn can ever attack. A supported knight deep in enemy territory cramps the opponent, can't be chased away, and is often worth more than a bishop.` };
      case 'strong-bishop':
        return { headline: `${san} gives the bishop a commanding diagonal.`, tags, visuals,
          summary: `${My} bishop on ${s.to} takes a long open diagonal, hitting ${s.mobilityAfter} squares from one post.`,
          detail: `From ${s.to} the bishop sweeps a long, unobstructed diagonal. A bishop with open lines — and its own pawns off its colour — is a powerful long-range piece that quietly dominates both wings.` };
      case 'connected-rooks':
        return { headline: `${san} connects the rooks.`, tags, visuals,
          summary: `${My} rooks now defend each other along the back rank — development is done and they can contest open files together.`,
          detail: `The rooks now defend one another along the back rank — development is complete and the heavy pieces are coordinated. Connected rooks contest open files together and back up each other's invasions.` };
      case 'developed':
        return { headline: `${san} brings the ${piece} into play.`, tags, visuals,
          summary: `${My} ${piece} comes into play on ${s.to}${supports}.`,
          detail: `${san} takes the ${piece} off its starting square and into the game${supports}. In the opening the plan is simple: every minor piece out, then castle — pieces sitting at home are pieces not helping you.` };
      case 'activated':
        return { headline: `${san} activates the ${piece}.`, tags, visuals,
          summary: `${My} ${piece} jumps from ${s.mobilityBefore} available squares to ${s.mobilityAfter} on ${s.to}${supports}.`,
          detail: `The ${piece} goes from ${s.mobilityBefore} available squares to ${s.mobilityAfter}, swinging into play. Active pieces decide games — a piece doing nothing is effectively a piece down.` };
      case 'passive-piece':
        return { headline: `${san} leaves the ${piece} passive.`, tags, visuals,
          summary: `${My} ${piece} on ${s.to} controls just ${s.mobilityAfter} square${s.mobilityAfter === 1 ? '' : 's'} — boxed in and doing little.`,
          detail: `On ${s.to} the ${piece} controls only ${s.mobilityAfter} square${s.mobilityAfter === 1 ? '' : 's'} — boxed in and contributing little. Drifting pieces are how good positions quietly go wrong; look for a square where the ${piece} hits the centre or an open line.` };
      case 'bad-bishop':
        return { headline: `${san} shuts in the bishop.`, tags, visuals,
          summary: `Putting a pawn on ${s.to} walls in ${my} ${squareColor(s.to)}-squared bishop behind its own pawns.`,
          detail: `Fixing a pawn on a ${squareColor(s.to)} square walls your ${squareColor(s.to)}-squared bishop in behind its own pawns — the classic "bad bishop" with no scope. Keep your pawns on the colour OPPOSITE your bishop so it stays mobile.` };
      case 'missed-activity':
        return { headline: `${san} misses a more active move.`, tags, visuals,
          summary: `The engine's move ${s.bestActivation}; ${san} leaves the piece doing less.`,
          detail: `The engine's move ${s.bestActivation}; your move leaves the piece doing less. In quiet positions the side with the more active pieces holds the pull — the practical rule is to improve your worst-placed piece.` };
      default:
        return { headline: `${san}`, detail: '', tags };
    }
  }

  /** Arrows/highlights that show WHERE the activity claim happens. */
  private visualsFor(s: ActivitySignals): Visuals {
    const arrows: ArrowHint[] = [];
    const squares: SquareHint[] = [];
    const move = (color: ArrowHint['color']) => {
      if (s.from && s.to) arrows.push({ from: s.from, to: s.to, color });
    };
    switch (s.kind) {
      case 'developed':
      case 'activated':
      case 'strong-bishop':
        move('idea');
        squares.push({ square: s.to, color: 'idea' });
        for (const sq of s.centerSupport) {
          arrows.push({ from: s.to, to: sq, color: 'target' });
          squares.push({ square: sq, color: 'target' });
        }
        break;
      case 'knight-outpost':
        move('idea');
        squares.push({ square: s.to, color: 'idea' });
        break;
      case 'rook-open-file':
        move('idea');
        squares.push({ square: s.to, color: 'idea' });
        break;
      case 'connected-rooks':
        move('idea');
        break;
      case 'passive-piece':
      case 'bad-bishop':
        squares.push({ square: s.to, color: 'danger' });
        break;
      case 'missed-activity':
        if (s.bestUci.length >= 4) {
          arrows.push({ from: s.bestUci.slice(0, 2), to: s.bestUci.slice(2, 4), color: 'best' });
        }
        break;
    }
    return { arrows, squares };
  }

  protected override improvements(ctx: MoveContext): readonly Improvement[] {
    const s = this.signals(ctx);
    const tips: Improvement[] = [];
    if (s.kind === 'missed-activity') {
      tips.push({ moveUci: s.bestUci, advice: `Prefer the engine's move — it ${s.bestActivation}.` });
    } else if (s.kind === 'passive-piece' || s.kind === 'bad-bishop') {
      tips.push({ moveUci: s.bestUci, advice: 'The engine keeps the pieces active with a different move.' });
    }
    tips.push({
      advice: PRAISE_KINDS.has(s.kind as ActivityKind)
        ? 'Keep improving your least active piece each move — activity compounds into a lasting edge.'
        : 'Before a quiet move, ask which of your pieces is worst-placed and find a move that improves it.',
    });
    return tips;
  }
}
