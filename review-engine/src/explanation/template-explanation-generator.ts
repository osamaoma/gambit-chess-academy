/**
 * Module 7 — ExplanationGenerator, without a model.
 *
 * The Gemini implementation needs a key, a network round trip and a budget. A
 * review engine should still produce readable coaching when none of those are
 * available, so this writes from the pipeline's OWN findings — the themes,
 * motifs, priorities and best-move comparison the other eight modules already
 * produced. No chess is worked out here; it only chooses words.
 *
 * House style matches the hosted writer, so swapping between them does not
 * change the voice:
 *  - one or two SHORT sentences;
 *  - plain English, no jargon;
 *  - teach the idea, don't grade the move;
 *  - never mention engines, evaluations or centipawns.
 *
 * It is the pipeline's default precisely because it cannot fail: no network, no
 * key, no quota.
 */

import type {
  Explanation,
  ExplanationGenerator,
  ExplanationInput,
  Motif,
  MoveComparison,
} from '../types';

/** Tactic ids the pipeline may report, in plain language. */
const MOTIF_PHRASE: Readonly<Record<string, string>> = {
  fork: 'attacks two pieces at once',
  pin: 'pins a piece against something more valuable',
  skewer: 'forces a big piece to move and wins the one behind it',
  'double-attack': 'hits two things at the same time',
  'discovered-check': 'uncovers a check from another piece',
  'discovered-attack': 'uncovers an attack from another piece',
  'back-rank': "exploits the king's back rank",
  'mating-net': 'closes a mating net around the king',
  overloaded: 'overloads a defender that is already busy',
  deflection: 'drags a defender away from what it was guarding',
  decoy: 'lures a piece onto a bad square',
  'x-ray': 'works straight through a piece to what is behind it',
};

/** "knight", "rook" — the comparator already resolves piece names for us. */
const pieceOf = (cmp: MoveComparison | null): string => cmp?.bestPiece ?? 'piece';

/** Where the better move was going. */
const squareOf = (cmp: MoveComparison): string => cmp.best.slice(2, 4);

const strongest = (motifs: readonly Motif[], source: Motif['source']): Motif | undefined =>
  motifs.filter((m) => m.source === source).sort((a, b) => b.confidence - a.confidence)[0];

export interface TemplateGeneratorOptions {
  /** Hard ceiling, matching the hosted writer's limit. */
  readonly maxWords?: number;
}

export class TemplateExplanationGenerator implements ExplanationGenerator {
  private readonly maxWords: number;

  constructor(options: TemplateGeneratorOptions = {}) {
    this.maxWords = options.maxWords ?? 80;
  }

  async generate(input: ExplanationInput): Promise<Explanation> {
    return { summary: this.trim(this.write(input)), source: 'fallback' };
  }

  private write(input: ExplanationInput): string {
    const { comparison, motifs, themes, priorities } = input;
    const foundBest = !comparison || comparison.isSameMove;

    // ── A tactic the player actually played is the most concrete thing to say ──
    const played = strongest(motifs, 'played');
    if (played && MOTIF_PHRASE[played.id]) {
      return `Your move ${MOTIF_PHRASE[played.id]}, which is what makes it strong.`;
    }

    // ── A better move existed: say what it would have done ──
    if (!foundBest && comparison) {
      const missed = strongest(motifs, 'best');
      if (missed && MOTIF_PHRASE[missed.id]) {
        return `There was a stronger idea here: a move that ${MOTIF_PHRASE[missed.id]}.`;
      }
      if (comparison.bestCaptures) {
        return `Taking on ${squareOf(comparison)} would have won material. `
          + `As played, that chance goes away.`;
      }
      if (comparison.bestGivesCheck) {
        return `A check with the ${pieceOf(comparison)} would have forced your opponent to react, `
          + `giving you time to improve your position.`;
      }
      if (comparison.movesSamePiece) {
        return `Right piece, wrong square — the ${pieceOf(comparison)} belonged on `
          + `${squareOf(comparison)}, where it does more.`;
      }
      const plan = priorities[0];
      if (plan) {
        return `Bringing the ${pieceOf(comparison)} to ${squareOf(comparison)} was stronger. `
          + `The position is asking you to ${plan.statement}.`;
      }
      return `Moving the ${pieceOf(comparison)} to ${squareOf(comparison)} would have done more here.`;
    }

    // ── The player found the best move: say what it achieves ──
    const theme = themes[0];
    if (theme) {
      const where = theme.squares?.[0];
      switch (theme.id) {
        case 'development':
          return `This brings another piece into the game, which is exactly what the opening asks for.`;
        case 'king-safety':
          return `This tucks your king away safely and gets your rooks working together.`;
        case 'central-control':
          return where
            ? `Claiming ${where} in the centre gives your pieces more room to work with.`
            : `Taking space in the centre gives your pieces more room to work with.`;
        case 'open-file':
          return `Your rook takes the open file, where it has real scope.`;
        case 'piece-activity':
          return `That piece has far more squares to work with now.`;
        case 'material':
          return `This wins material, and material is the simplest advantage to convert.`;
        default:
          break;
      }
    }

    const plan = priorities[0];
    if (plan) return `A solid move. From here, the plan is to ${plan.statement}.`;
    return `A steady move that keeps your position healthy.`;
  }

  /** Enforce the ceiling the house style promises, cutting at a sentence end. */
  private trim(text: string): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= this.maxWords) return text.trim();
    const clipped = words.slice(0, this.maxWords).join(' ');
    const stop = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('!'), clipped.lastIndexOf('?'));
    return stop > 20 ? clipped.slice(0, stop + 1) : `${clipped}…`;
  }
}
