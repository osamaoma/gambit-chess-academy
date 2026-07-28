/**
 * Browser entry point — bundles the whole engine into a single global for the
 * host app (Gambit Chess Academy's static `index.html`, which has no module
 * loader). esbuild turns this file into `gambit_lite/public/explanation-engine.js`,
 * exposing `window.GambitExplain`.
 *
 * The app already has FENs, a Stockfish bridge and a classifier; it only needs
 * to hand us one fully-described move. `buildContext` is a forgiving adapter
 * that fills the {@link MoveContext} shape from the loose per-move data the
 * Game Review keeps (`ann` + history), deriving mover-perspective deltas so the
 * caller doesn't have to. `explain` then returns a {@link UserExplanation} or
 * `null` (caller falls back to its own stock note).
 */

import { DetectorRegistry } from './registry';
import { ExplanationEngine, UserExplanation } from './engine';
import { ExplanationSelector } from './selector';
import { DevelopmentDetector } from './detectors/development';
import { HangingPieceDetector } from './detectors/hanging-piece';
import { MaterialDetector } from './detectors/material';
import { KingSafetyDetector } from './detectors/king-safety';
import { tacticalDetectors } from './detectors/tactical';
import { PieceActivityDetector } from './detectors/piece-activity';
import { PawnStructureDetector } from './detectors/pawn-structure';
import { CenterControlDetector } from './detectors/center-control';
import { EndgameDetector } from './detectors/endgame';
import { applyUciMove, parseFen, parseUciMove, toFen } from './board';
import { readMove } from './facts';
import { Subject, writeExplanation } from './coach';
import { EngineEval, EngineLine, MoveClassification, MoveContext } from './types';

/** The full production detector roster, registered once. */
function buildEngine(): ExplanationEngine {
  const registry = new DetectorRegistry()
    .register(new HangingPieceDetector())
    .register(new MaterialDetector())
    .register(new KingSafetyDetector())
    .register(new PieceActivityDetector())
    .register(new PawnStructureDetector())
    .register(new CenterControlDetector())
    .register(new EndgameDetector())
    .register(new DevelopmentDetector())
    .registerAll(tacticalDetectors());
  return new ExplanationEngine(registry, new ExplanationSelector({ maxSupporting: 2 }));
}

const engine = buildEngine();

/** Loose shape the host passes in — every field optional so a partial move still works. */
export interface RawMove {
  fenBefore?: string;
  fenAfter?: string;
  san?: string;
  uci?: string;
  ply?: number;
  /** 'white' | 'black'; inferred from fenBefore's side-to-move when omitted. */
  mover?: string;
  classification?: string;
  /** Best move UCI in the position before (engine's recommendation). */
  bestUci?: string;
  /** Best line before the move, as a UCI list or a space-separated UCI string. */
  bestPv?: readonly string[] | string;
  /** Eval (pawns, White's POV) before / after the move. */
  evalBeforeCp?: number;
  evalAfterCp?: number;
  /** Mate distances if the position is a forced mate (White's POV). */
  mateBefore?: number | null;
  mateAfter?: number | null;
  /** Pre-computed mover-perspective numbers, when the host already has them. */
  evalLossPawns?: number;
  winPctBefore?: number;
  winPctAfter?: number;
  /** Optional meta. */
  openingName?: string;
  clockRemaining?: number;
  timeSpent?: number;
  /** 'white' | 'black' — the side the person reading the review played. */
  viewerColor?: string;
}

const VALID_CLASS: ReadonlySet<string> = new Set<MoveClassification>([
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced',
  'inaccuracy', 'mistake', 'miss', 'blunder',
]);

/** Side to move from a FEN, defaulting to white if unreadable. */
function sideToMove(fen: string | undefined): 'white' | 'black' {
  const field = (fen ?? '').split(/\s+/)[1];
  return field === 'b' ? 'black' : 'white';
}

/** cp (White POV) → mover-perspective pawns. */
function moverPawns(cp: number, mover: 'white' | 'black'): number {
  const pawns = cp / 100;
  return mover === 'white' ? pawns : -pawns;
}

/** Lichess-style win probability (0–100) for the mover, from mover-perspective pawns. */
function winPct(pawns: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.368 * pawns)) - 1);
}

function toPv(pv: RawMove['bestPv']): string[] {
  if (!pv) return [];
  const list = Array.isArray(pv) ? pv : String(pv).trim().split(/\s+/);
  return list.filter((m) => /^[a-h][1-8][a-h][1-8][nbrq]?$/.test(m));
}

function makeEval(uci: string, cp: number, mate: number | null, pv: string[]): EngineEval {
  const alternatives: EngineLine[] = [];
  return { uci, scoreCp: mate == null ? cp : null, mateIn: mate ?? null, pv, depth: 0, alternatives };
}

/**
 * Build a {@link MoveContext} from the host's loose per-move data. Returns null
 * only when the essentials (a before-FEN, an after-FEN and the played move) are
 * missing — everything else is defaulted so a detector can still try.
 */
export function buildContext(raw: RawMove): MoveContext | null {
  const fenBefore = raw.fenBefore;
  const fenAfter = raw.fenAfter;
  const uci = raw.uci;
  if (!fenBefore || !fenAfter || !uci) return null;

  const mover = (raw.mover === 'white' || raw.mover === 'black') ? raw.mover : sideToMove(fenBefore);
  const classification: MoveClassification =
    (raw.classification && VALID_CLASS.has(raw.classification))
      ? raw.classification as MoveClassification
      : 'good';

  const bestUci = raw.bestUci && /^[a-h][1-8][a-h][1-8][nbrq]?$/.test(raw.bestUci) ? raw.bestUci : uci;
  const cpBefore = Number.isFinite(raw.evalBeforeCp as number) ? (raw.evalBeforeCp as number) : 0;
  const cpAfter = Number.isFinite(raw.evalAfterCp as number) ? (raw.evalAfterCp as number) : cpBefore;

  const evalBefore = makeEval(bestUci, cpBefore, raw.mateBefore ?? null, toPv(raw.bestPv));
  const evalAfter = makeEval(uci, cpAfter, raw.mateAfter ?? null, []);

  const mbPawns = moverPawns(cpBefore, mover);
  const maPawns = moverPawns(cpAfter, mover);
  const winBefore = Number.isFinite(raw.winPctBefore as number) ? (raw.winPctBefore as number) : winPct(mbPawns);
  const winAfter = Number.isFinite(raw.winPctAfter as number) ? (raw.winPctAfter as number) : winPct(maPawns);
  const evalLoss = Number.isFinite(raw.evalLossPawns as number)
    ? Math.max(0, raw.evalLossPawns as number)
    : Math.max(0, mbPawns - maPawns);

  return {
    fenBefore,
    fenAfter,
    san: raw.san || uci,
    uci,
    ply: Number.isFinite(raw.ply as number) ? (raw.ply as number) : 1,
    mover,
    evalBefore,
    evalAfter,
    classification,
    deltas: {
      evalBefore: mbPawns,
      evalAfter: maPawns,
      evalLoss,
      winPctBefore: winBefore,
      winPctAfter: winAfter,
      winPctDrop: Math.max(0, winBefore - winAfter),
    },
    meta: {
      ...(raw.openingName ? { openingName: raw.openingName } : {}),
      ...(Number.isFinite(raw.clockRemaining as number) ? { clockRemaining: raw.clockRemaining } : {}),
      ...(Number.isFinite(raw.timeSpent as number) ? { timeSpent: raw.timeSpent } : {}),
      ...(raw.viewerColor === 'white' || raw.viewerColor === 'black' ? { viewerColor: raw.viewerColor } : {}),
    },
  };
}

/**
 * Explain one move described by the host's loose data.
 *
 * The card's sentence ALWAYS comes from {@link narrate}, never from a detector.
 * Two reasons, both learned the hard way:
 *  - a detector may be describing the ENGINE's move rather than the one played,
 *    which reads as a flat lie ("you played c5" + "there was a bishop pin");
 *  - detector prose is club-player language, and this card has to be readable
 *    by a small child.
 *
 * Detectors still do the expert work behind the scenes (tips, tags, the deeper
 * detail), but what the reader SEES is a plain, true sentence about the move
 * they actually made. Every move gets one — quiet moves included.
 */
export function explain(raw: RawMove): UserExplanation | null {
  const ctx = buildContext(raw);
  if (!ctx) return null;

  // The detectors run FIRST — they work out the real chess ideas. The writing
  // engine then turns those into coach-speak.
  let expert: UserExplanation | null = null;
  try { expert = engine.explainMove(ctx); } catch { expert = null; }

  const facts = readMove(ctx);
  if (!facts) return expert;                      // unreadable position

  // To say what a slip MISSED we have to know what the better move was FOR, so
  // the detectors are run a second time on the recommended move. This is the
  // only honest way to answer "what was the best idea?" without quoting a score.
  let best: { subject: Subject; tags?: readonly string[] } | undefined;
  const bestUci = ctx.evalBefore.uci;
  const isSlip = SLIPS.has(ctx.classification);
  if (isSlip && bestUci && bestUci.slice(0, 4) !== ctx.uci.slice(0, 4)) {
    try {
      const board = parseFen(ctx.fenBefore);
      const mv = parseUciMove(bestUci);
      const moved = board.squares.get(mv.from);
      const taken = board.squares.get(mv.to);
      if (moved) {
        const bestCtx: MoveContext = {
          ...ctx,
          uci: bestUci,
          san: bestUci,
          fenAfter: toFen(applyUciMove(board, bestUci)),
          classification: 'best',
          // The played move's deltas describe ITS loss. Carrying them over would
          // tell the detectors this recommended move also threw the game away,
          // and they would refuse to praise it. The best move loses nothing.
          deltas: {
            ...ctx.deltas,
            evalAfter: ctx.deltas.evalBefore,
            evalLoss: 0,
            winPctAfter: ctx.deltas.winPctBefore,
            winPctDrop: 0,
          },
        };
        let bestTags: readonly string[] | undefined;
        try { bestTags = engine.explainMove(bestCtx)?.tags; } catch { bestTags = undefined; }
        best = {
          subject: {
            piece: moved.type,
            from: mv.from,
            to: mv.to,
            captured: taken && taken.color !== moved.color ? taken.type : null,
          },
          tags: bestTags,
        };
      }
    } catch { best = undefined; }
  }

  const written = writeExplanation({
    ctx,
    facts,
    playedTags: expert?.tags,
    playedSquares: expert?.visuals?.squares,
    best,
  });

  if (!expert) {
    return {
      san: ctx.san,
      ply: ctx.ply,
      classification: ctx.classification,
      headline: written.summary,
      summary: written.summary,
      detail: '',
      improvements: [],
      tags: ['coach'],
      supporting: [],
      sources: ['coach'],
      confidence: 0.5,
      visuals: written.visuals,
    };
  }
  return { ...expert, summary: written.summary, visuals: written.visuals };
}

/** Classifications where the player had a better option worth teaching. */
const SLIPS: ReadonlySet<MoveClassification> = new Set<MoveClassification>([
  'inaccuracy', 'mistake', 'blunder', 'miss',
]);

/** Explain a ready-made MoveContext (for callers that build their own). */
export function explainContext(ctx: MoveContext): UserExplanation | null {
  try {
    return engine.explainMove(ctx);
  } catch {
    return null;
  }
}

export type { UserExplanation } from './engine';
export type { MoveContext } from './types';
