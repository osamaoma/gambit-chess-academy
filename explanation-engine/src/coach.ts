/**
 * The explanation WRITING engine.
 *
 * The detectors decide WHAT is true about a position. This module decides how
 * to say it to a learner. Those are different jobs and they are kept apart on
 * purpose: detectors may never write prose, and this file may never invent
 * chess facts.
 *
 * House style (non-negotiable):
 *  - one or two SHORT sentences, never a paragraph;
 *  - plain English, no jargon a beginner would have to look up;
 *  - educational, not analytical — teach the idea, don't grade the move;
 *  - never mention engines, evaluations or centipawns. A learner cannot act on
 *    "-0.8"; they can act on "your knight had nowhere to go".
 *
 * Every explanation answers three questions:
 *  1. What was the best idea?
 *  2. Why was it strong?
 *  3. What did the played move miss or allow?
 *
 * For a good move, (1) and (2) collapse into "here is what your move achieved".
 * For a slip, we describe the better idea and then what actually happened —
 * which is why the caller analyses the BEST move as well as the played one and
 * hands us both. Naming real pieces and squares is what stops the output
 * turning into "this challenges the centre" wallpaper.
 */

import { fileIndex, PieceType } from './board';
import { Visuals, ArrowHint, SquareHint } from './detector';
import { MoveContext } from './types';
import { MoveFacts } from './facts';

/** Plain names. No cute nicknames, no "minor piece". */
const WORD: Readonly<Record<PieceType, string>> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

const fileLetter = (sq: string): string => 'abcdefgh'.charAt(fileIndex(sq));

/** Facts a sentence may quote, so the wording is about THIS position. */
export interface Subject {
  /** The piece that moved (or would have moved). */
  readonly piece: PieceType;
  readonly from: string;
  readonly to: string;
  /** Something captured by the move, if any. */
  readonly captured: PieceType | null;
}

/**
 * What a move ACHIEVES, keyed by the detector's idea.
 *
 * Present tense, addressed to the player: this is used when the move was
 * actually played and was a good one.
 */
const ACHIEVES: Readonly<Record<string, (s: Subject) => string>> = {
  'developed': (s) => `Bringing your ${WORD[s.piece]} to ${s.to} gets another piece into the game.`,
  'occupy-center': (s) => `Your pawn on ${s.to} claims space in the centre and gives your pieces more room.`,
  'contest-center': (s) => `Pushing to ${s.to} challenges the centre before your opponent settles in there.`,
  'strong-center': () => `You now hold the middle of the board, so your pieces can move where they are needed.`,
  'knight-outpost': (s) => `Your knight on ${s.to} cannot be chased away by pawns, so it stays strong there.`,
  'rook-open-file': (s) => `Your rook now has the open ${fileLetter(s.to)}-file to work on.`,
  'strong-bishop': (s) => `Your bishop on ${s.to} has a clear diagonal and can reach both sides of the board.`,
  'connected-rooks': () => `Your rooks now protect each other and can work as a pair.`,
  'activated': (s) => `Your ${WORD[s.piece]} has far more squares to work with from ${s.to}.`,
  'passed-pawn': (s) => `Your pawn on ${s.to} has no enemy pawns left in front of it and can run for the far end.`,
  'connected-passers': () => `Two of your pawns can now advance side by side, defending each other as they go.`,
  'pawn-majority': () => `You have the extra pawn on one side, which is how you make a new queen later.`,
  'strong-chain': () => `Your pawns defend each other in a chain, which is hard for your opponent to break.`,
  'damaged-enemy-structure': () => `That leaves your opponent with weak pawns they will have to babysit.`,
  'promotion-threat': (s) => `Your pawn on ${s.to} is close to the end, and your opponent must spend time stopping it.`,
  'outside-passer': () => `Your passed pawn is far from the enemy king, so it is hard for them to catch.`,
  'king-activity': (s) => `Your king steps up to ${s.to}. In an endgame the king is a fighting piece.`,
  'rook-activity': () => `Your rook gets active behind the passed pawn, which is where it does the most work.`,
  'opposition': () => `Your king takes the opposition, forcing the other king to give way first.`,
  'fork': () => `Your ${'knight'} attacks two pieces at once, so your opponent cannot save both.`,
  'skewer': () => `You line up two pieces, so when the front one moves you win the one behind it.`,
  'back-rank': () => `Your opponent's king is stuck behind its own pawns, which is what makes this so strong.`,
  'double-attack': () => `You hit two things at once, and your opponent can only defend one of them.`,
  'discovered-check': () => `Moving one piece uncovers a check from another, so you get a free move.`,
  'sacrifice': () => `You give up material on purpose here, because the attack that follows is worth more.`,
  'win-material': (s) => s.captured
    ? `Taking the ${WORD[s.captured]} on ${s.to} wins material because it was not properly defended.`
    : `This wins material.`,
};

/**
 * What a move WOULD have achieved — same ideas, conditional voice.
 * Used to describe the better move the player did not make.
 */
const WOULD_ACHIEVE: Readonly<Record<string, (s: Subject) => string>> = {
  'developed': (s) => `Developing your ${WORD[s.piece]} to ${s.to} would have brought another piece into the game.`,
  'occupy-center': (s) => `Pushing your pawn to ${s.to} would have claimed the centre and freed your pieces.`,
  'contest-center': (s) => `Challenging the centre with ${s.to} would have stopped your opponent taking it over.`,
  'strong-center': () => `Taking the middle of the board would have given your pieces much more room.`,
  'knight-outpost': (s) => `Putting your knight on ${s.to} would have given it a square no pawn could attack.`,
  'rook-open-file': (s) => `Swinging your rook to the open ${fileLetter(s.to)}-file would have given it real work.`,
  'strong-bishop': (s) => `Placing your bishop on ${s.to} would have opened up its diagonal.`,
  'connected-rooks': () => `Joining your rooks would have let them support each other.`,
  'activated': (s) => `Moving your ${WORD[s.piece]} to ${s.to} would have given it many more squares.`,
  'passed-pawn': () => `You had a chance to create a pawn that nothing could stop.`,
  'promotion-threat': (s) => `Pushing to ${s.to} would have forced your opponent to deal with your pawn.`,
  'king-activity': (s) => `Walking your king to ${s.to} would have brought it into the fight.`,
  'rook-activity': () => `Getting your rook behind the passed pawn would have made it far more useful.`,
  'fork': () => `You had a fork available, attacking two pieces at once.`,
  'skewer': () => `Lining up their pieces would have won the one hiding behind.`,
  'back-rank': () => `Their king was stuck on the back row, and you could have used that.`,
  'double-attack': () => `You could have attacked two things at once, and they cannot defend both.`,
  'discovered-check': () => `Stepping one piece aside would have uncovered a check and won time.`,
  'win-material': (s) => s.captured
    ? `You could have taken the ${WORD[s.captured]} on ${s.to} — it was not defended.`
    : `There was free material available here.`,
};

/**
 * When a better move existed but no detector named an idea for it, still say
 * something concrete about THAT move — what it takes, or where it goes.
 */
function genericBetter(s: Subject): string {
  if (s.captured) return `Taking the ${WORD[s.captured]} on ${s.to} was the better option here.`;
  if (s.piece === 'p') return `Pushing your pawn to ${s.to} was the stronger idea.`;
  if (s.piece === 'k') return `Tucking your king to ${s.to} was safer.`;
  return `Bringing your ${WORD[s.piece]} to ${s.to} would have done more for your position.`;
}

/**
 * What the played move let happen. This is question 3, and it is the half most
 * reviews skip — a learner needs the consequence, not the verdict.
 */
export function consequence(f: MoveFacts): string | null {
  if (f.leftHanging) {
    return `As played, your ${WORD[f.leftHanging.type]} on ${f.leftHanging.square} is left undefended.`;
  }
  if (f.piece !== 'p' && f.mobilityAfter <= 2) {
    return `As played, your ${WORD[f.piece]} has very little to do on ${f.to}.`;
  }
  return null;
}

/** Order ideas by how much they explain a move, not by how sure we are of them. */
const IDEA_ORDER: readonly string[] = [
  'back-rank', 'fork', 'skewer', 'double-attack', 'discovered-check',
  'win-material', 'sacrifice',
  'developed', 'occupy-center', 'knight-outpost', 'rook-open-file', 'strong-bishop',
  'connected-rooks', 'activated', 'contest-center', 'strong-center',
  'promotion-threat', 'outside-passer', 'passed-pawn', 'connected-passers',
  'pawn-majority', 'strong-chain', 'damaged-enemy-structure',
  'king-activity', 'rook-activity', 'opposition',
];

/** Pick the idea that best explains a move from a detector's tags. */
export function ideaOf(tags: readonly string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  const present = new Set(tags);
  for (const kind of IDEA_ORDER) if (present.has(kind)) return kind;
  return null;
}

/** Sentence for a move that WAS played and was a good one. */
export function praise(idea: string | null, s: Subject): string | null {
  const make = idea ? ACHIEVES[idea] : undefined;
  return make ? make(s) : null;
}

/** Sentence for the better move that was NOT played. */
export function suggest(idea: string | null, s: Subject): string {
  const make = idea ? WOULD_ACHIEVE[idea] : undefined;
  return make ? make(s) : genericBetter(s);
}

/**
 * Draw ONLY what the sentence talks about.
 *
 * A mark the words never mention is a puzzle, not a hint: a red arrow on a
 * "you developed your bishop" card just makes the reader hunt for a threat
 * that was never explained. So the caller says what it wrote about, and that
 * is exactly what gets drawn.
 */
export function visualsFor(opts: {
  /** The better move being recommended — worth an arrow, since it is not on the board. */
  readonly best?: Subject | null;
  /** A piece the text says is hanging. */
  readonly hanging?: { readonly square: string; readonly attacker: string | null } | null;
  /** Squares a detector wants lit for the idea (danger colours are dropped). */
  readonly ideaSquares?: readonly SquareHint[];
  /** The square the move landed on, when the sentence is about that piece. */
  readonly landed?: string | null;
}): Visuals {
  const arrows: ArrowHint[] = [];
  const squares: SquareHint[] = [];
  if (opts.best) {
    arrows.push({ from: opts.best.from, to: opts.best.to, color: 'idea' });
    squares.push({ square: opts.best.to, color: 'idea' });
  }
  if (opts.landed) squares.push({ square: opts.landed, color: 'idea' });
  for (const s of opts.ideaSquares ?? []) {
    if (s.color !== 'danger') squares.push(s);
  }
  if (opts.hanging) {
    squares.push({ square: opts.hanging.square, color: 'danger' });
    if (opts.hanging.attacker) {
      arrows.push({ from: opts.hanging.attacker, to: opts.hanging.square, color: 'danger' });
    }
  }
  // De-duplicate so a square lit twice doesn't fight itself.
  const seen = new Set<string>();
  return {
    arrows,
    squares: squares.filter((s) => (seen.has(s.square) ? false : (seen.add(s.square), true))),
  };
}

/** Trim to at most two sentences, however many the callers glued together. */
export function twoSentences(text: string): string {
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text.trim();
  return parts.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
}

/** Everything the writer needs. The caller supplies facts; we supply words. */
export interface WriteInput {
  readonly ctx: MoveContext;
  readonly facts: MoveFacts;
  /** Tags from the detectors that looked at the PLAYED move. */
  readonly playedTags?: readonly string[];
  /** Squares the detectors want highlighted for the played move's idea. */
  readonly playedSquares?: readonly SquareHint[];
  /** The better move and what the detectors said about it — only for slips. */
  readonly best?: { readonly subject: Subject; readonly tags?: readonly string[] };
}

export interface Written {
  readonly summary: string;
  readonly visuals: Visuals;
}

/**
 * Write the explanation for one move.
 *
 * A slip gets "here was the better idea" + "here is what your move allowed".
 * A good move gets "here is what your move achieved". Both stay inside two
 * short sentences, and neither ever mentions an evaluation.
 */
export function writeExplanation(input: WriteInput): Written {
  const { ctx, facts: f, best } = input;
  const subject: Subject = { piece: f.piece, from: f.from, to: f.to, captured: f.captured };

  // ── Things that end or decide the game are the lesson, whatever else is true ──
  if (f.mate) {
    return {
      summary: `Checkmate. Your ${WORD[f.piece]} on ${f.to} traps the king with no way out.`,
      visuals: visualsFor({ landed: f.to }),
    };
  }

  // ── A slip: teach the better idea, then the consequence ──
  if (best) {
    const better = suggest(ideaOf(best.tags), best.subject);
    const cost = consequence(f);
    return {
      summary: twoSentences(cost ? `${better} ${cost}` : better),
      // The red mark appears only when the text actually named a loose piece.
      visuals: visualsFor({
        best: best.subject,
        hanging: cost && f.leftHanging ? { square: f.leftHanging.square, attacker: f.hangingAttacker } : null,
      }),
    };
  }

  // ── A good move: say what it achieved ──
  const idea = praise(ideaOf(input.playedTags), subject);
  if (idea) {
    return { summary: idea, visuals: visualsFor({ landed: f.to, ideaSquares: input.playedSquares }) };
  }

  // Detectors had no named idea. Fall back to something concrete and true —
  // never to filler, and never to "the computer liked it".
  if (f.castled) {
    return {
      summary: `Castling puts your king somewhere safe and brings your rook towards the middle.`,
      visuals: visualsFor({ landed: f.to }),
    };
  }
  if (f.promoted) {
    return {
      summary: `Your pawn reaches the end and becomes a ${WORD[f.promoted]}.`,
      visuals: visualsFor({ landed: f.to }),
    };
  }
  if (f.captured) {
    return {
      summary: `You take the ${WORD[f.captured]} on ${f.to}.`,
      visuals: visualsFor({ landed: f.to }),
    };
  }
  const hit = f.nowAttacks[0];
  if (hit) {
    return {
      summary: `Your ${WORD[f.piece]} now attacks the ${WORD[hit.type]} on ${hit.square}, so it has to be dealt with.`,
      visuals: {
        arrows: [{ from: f.to, to: hit.square, color: 'danger' }],
        squares: [{ square: hit.square, color: 'danger' }],
      },
    };
  }
  const helped = f.guards[0];
  if (helped) {
    return {
      summary: `Your ${WORD[f.piece]} defends the ${WORD[helped.type]} on ${helped.square}, which was under attack.`,
      visuals: {
        arrows: [{ from: f.to, to: helped.square, color: 'idea' }],
        squares: [{ square: helped.square, color: 'idea' }],
      },
    };
  }
  if (f.check) {
    return {
      summary: `This check forces your opponent to answer it straight away.`,
      visuals: visualsFor({ landed: f.to }),
    };
  }
  const denied = f.denies[0];
  if (denied) {
    return {
      summary: `This takes ${denied} away from your opponent, so nothing of theirs can settle there.`,
      visuals: { arrows: [], squares: [{ square: denied, color: 'idea' }] },
    };
  }
  if (f.cameOut) {
    return {
      summary: `Bringing your ${WORD[f.piece]} to ${f.to} gets another piece into the game.`,
      visuals: visualsFor({ landed: f.to }),
    };
  }
  return {
    summary: `A quiet move. Your ${WORD[f.piece]} sits on ${f.to} waiting for a better moment.`,
    visuals: { arrows: [], squares: [] },
  };
}

export { WORD as PIECE_WORD };
export type { MoveContext };
