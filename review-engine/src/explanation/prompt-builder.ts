/**
 * Turns a finished analysis into a prompt.
 *
 * The single most important job here is CONTAINMENT. The model is a writer,
 * not an analyst: every chess conclusion — was the move good, what was best,
 * which motifs and themes are present, what the plan should be — is already
 * decided by this engine and arrives as data. The prompt therefore states the
 * facts and forbids the model from adding, doubting or re-deriving any of them.
 *
 * That is why the position is described in words and structured fields rather
 * than handed over as a bare FEN: given a FEN, a model will try to analyse.
 * Given a filled-in report, it will write.
 */

import type { ExplanationInput } from '../types';

export interface PromptConfig {
  /** Hard ceiling the prompt states and the parser enforces. */
  readonly maxWords: number;
  /** How many earlier summaries to show so the model can avoid echoing them. */
  readonly recentSummaryWindow: number;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  maxWords: 80,
  recentSummaryWindow: 6,
};

/**
 * The persona and the hard rules. Sent as a system instruction so it carries
 * more weight than anything in the turn content and does not have to be
 * repeated per request.
 */
export function buildSystemInstruction(config: PromptConfig = DEFAULT_PROMPT_CONFIG): string {
  return [
    'You are a world-class chess coach writing a one-line note for a student reviewing their game.',
    '',
    'YOUR ONLY JOB is to turn the structured analysis you are given into natural coaching language.',
    'All chess analysis is already complete and correct. You must not question it, re-analyse the',
    'position, or add chess claims of your own. If a fact is not in the report, do not state it.',
    '',
    'RULES:',
    `- Stay under ${config.maxWords} words. Two short sentences is ideal.`,
    '- When a better move is given, say what THAT move would have achieved, naming the piece and',
    '  square, and what the move played missed or allowed. Never just say "there was a better move".',
    '- When the student found the best move, say what their move achieves.',
    '- Write to the student as "you", and call the opponent "your opponent".',
    '- Plain English a beginner can follow. No jargon they would have to look up.',
    '- Never mention engines, evaluations, centipawns, scores, numbers of any kind, or that a computer',
    '  was involved. Never use the words "engine", "Stockfish", "eval", "centipawn" or "analysis".',
    '- Never mention the classification label itself (do not write "this was an inaccuracy").',
    '- Be encouraging and matter-of-fact. Never sarcastic, never scolding.',
    '- Vary your phrasing. Do not begin consecutive notes the same way.',
    '- Output the note only: no preamble, no bullet points, no markdown, no quotation marks.',
  ].join('\n');
}

/**
 * A flat, transport-friendly version of the findings.
 *
 * The prompt is composed on the SERVER from these named fields rather than
 * from free text sent by the browser. That is deliberate: an endpoint that
 * forwards arbitrary prompt text is an open relay on someone else's API quota.
 * Restricting it to this shape means the endpoint can only ever be used to
 * write chess coaching notes.
 */
export interface PromptFacts {
  /** The move played, in SAN if available ("Nf6"), else UCI. */
  readonly played: string;
  /** The classification this engine decided, e.g. "Inaccuracy". */
  readonly verdict: string;
  readonly phase?: string;
  /** The better move, when one existed and differed from the move played. */
  readonly best?: string;
  /** Which piece the better move moves ("knight"), for natural wording. */
  readonly bestPiece?: string;
  /** Where the better move lands ("e4"), so the note can name the square. */
  readonly bestTo?: string;
  readonly samePieceWrongSquare?: boolean;
  readonly bestCaptures?: boolean;
  readonly bestGivesCheck?: boolean;
  /** What the better move ACHIEVES, in this engine's words. */
  readonly bestIdeas?: readonly string[];
  readonly playedMotifs?: readonly string[];
  readonly missedMotifs?: readonly string[];
  readonly themes?: readonly string[];
  readonly priorities?: readonly string[];
  readonly openFiles?: readonly string[];
  /** Notes already written earlier in this review, to avoid echoing them. */
  readonly recentSummaries?: readonly string[];
}

/** The per-move report. Only fields with content are included, to keep it short. */
export function buildUserPromptFromFacts(
  f: PromptFacts,
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
): string {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined | null): void => {
    if (value) lines.push(`${label}: ${value}`);
  };
  const list = (v: readonly string[] | undefined): string | null => (v && v.length ? v.join(', ') : null);

  add('Move played', f.played);
  add('Verdict', f.verdict);
  add('Game phase', f.phase);

  if (f.best) {
    add('A better move existed', f.best);
    add('The better move moves the', f.bestPiece);
    add('It lands on', f.bestTo);
    // The single most useful field: WHY the better move was better.
    add('What that better move achieves', list(f.bestIdeas));
    if (f.samePieceWrongSquare) add('Note', 'the student chose the right piece but the wrong square');
    if (f.bestCaptures) add('The better move', 'wins material');
    if (f.bestGivesCheck) add('The better move', 'gives check');
    lines.push('');
    lines.push('Explain what the better move would have achieved, and what the played move missed.');
  } else {
    add('Note', 'the student found the best move; explain what it achieves');
  }

  add('Tactics in the move played', list(f.playedMotifs));
  add('Tactics available but missed', list(f.missedMotifs));
  add('Strategic themes', list(f.themes));
  add('What the position calls for', list(f.priorities));
  add('Open files', list(f.openFiles));

  const recent = (f.recentSummaries ?? []).slice(-config.recentSummaryWindow);
  if (recent.length > 0) {
    lines.push('');
    lines.push('Notes you already wrote earlier in this review — do NOT reuse their wording or openings:');
    for (const r of recent) lines.push(`- ${r}`);
  }

  lines.push('');
  lines.push(`Write the coaching note now, under ${config.maxWords} words.`);
  return lines.join('\n');
}

/** Build the prompt from a full pipeline result, via {@link buildUserPromptFromFacts}. */
export function buildUserPrompt(
  input: ExplanationInput,
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
): string {
  const cmp = input.comparison;
  const better = cmp && !cmp.isSameMove ? cmp : null;
  return buildUserPromptFromFacts({
    played: input.input.analysis.playedMove,
    verdict: input.classification.classification,
    phase: input.context.phase,
    ...(better
      ? {
          best: better.best,
          ...(better.bestPiece ? { bestPiece: better.bestPiece } : {}),
          bestTo: better.best.slice(2, 4),
          samePieceWrongSquare: better.movesSamePiece,
          bestCaptures: better.bestCaptures,
          bestGivesCheck: better.bestGivesCheck,
        }
      : {}),
    playedMotifs: input.motifs.filter((m) => m.source === 'played').map((m) => m.label),
    missedMotifs: input.motifs.filter((m) => m.source === 'best').map((m) => m.label),
    themes: input.themes.map((t) => t.label),
    priorities: input.priorities.map((p) => p.statement),
    openFiles: [...input.context.openFiles],
    ...(input.recentSummaries ? { recentSummaries: input.recentSummaries } : {}),
  }, config);
}

/**
 * Cache identity for one request.
 *
 * Deliberately excludes `recentSummaries`: those vary with where the reader is
 * in the review, and letting them into the key would make the cache miss
 * almost every time for no benefit.
 */
export function promptCacheKeyInput(input: ExplanationInput): unknown {
  return {
    played: input.input.analysis.playedMove,
    best: input.input.analysis.bestMove,
    fen: input.input.analysis.fenBefore,
    verdict: input.classification.classification,
    phase: input.context.phase,
    themes: input.themes.map((t) => t.id).sort(),
    motifs: input.motifs.map((m) => `${m.source}:${m.id}`).sort(),
    priorities: input.priorities.map((p) => p.id).sort(),
  };
}
