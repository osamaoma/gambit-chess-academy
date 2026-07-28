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
    `- Stay under ${config.maxWords} words. Two short sentences is ideal, one is often enough.`,
    '- Explain the IDEA behind the move: what it achieves, or what the better move would have achieved.',
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

/** The per-move report. Only fields with content are included, to keep it short. */
export function buildUserPrompt(input: ExplanationInput, config: PromptConfig = DEFAULT_PROMPT_CONFIG): string {
  const { analysis } = input.input;
  const lines: string[] = [];

  const add = (label: string, value: string | undefined | null): void => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add('Move played', analysis.playedMove);
  add('Verdict', input.classification.classification);
  add('Game phase', input.context.phase);

  // Only mention a better move when there genuinely was one.
  const cmp = input.comparison;
  if (cmp && !cmp.isSameMove) {
    add('A better move existed', cmp.best);
    if (cmp.bestPiece) add('The better move moves the', cmp.bestPiece);
    if (cmp.movesSamePiece) add('Note', 'the student chose the right piece but the wrong square');
    if (cmp.bestCaptures) add('The better move', 'captures material');
    if (cmp.bestGivesCheck) add('The better move', 'gives check');
  } else if (cmp?.isSameMove) {
    add('Note', 'the student found the best move');
  }

  if (input.motifs.length > 0) {
    const played = input.motifs.filter((m) => m.source === 'played').map((m) => m.label);
    const missed = input.motifs.filter((m) => m.source === 'best').map((m) => m.label);
    add('Tactics in the move played', played.join(', ') || null);
    add('Tactics that were available but missed', missed.join(', ') || null);
  }

  if (input.themes.length > 0) {
    add('Strategic themes', input.themes.map((t) => t.label).join(', '));
  }

  if (input.priorities.length > 0) {
    add('What the position calls for', input.priorities.map((p) => p.statement).join('; '));
  }

  if (input.context.openFiles.length > 0) {
    add('Open files', input.context.openFiles.join(', '));
  }

  const recent = (input.recentSummaries ?? []).slice(-config.recentSummaryWindow);
  if (recent.length > 0) {
    lines.push('');
    lines.push('Notes you already wrote earlier in this review — do NOT reuse their wording or openings:');
    for (const r of recent) lines.push(`- ${r}`);
  }

  lines.push('');
  lines.push(`Write the coaching note now, under ${config.maxWords} words.`);
  return lines.join('\n');
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
