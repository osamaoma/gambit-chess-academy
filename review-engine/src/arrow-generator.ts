/**
 * Module 5 — ArrowGenerator.
 *
 * Produces arrows as DATA — semantic colours and a reason, never pixels. The
 * host decides what "threat" looks like.
 *
 * Two rules earned from earlier mistakes, and both are enforced here rather
 * than left to the caller:
 *
 *  1. NEVER draw the played move from→to. The board already highlights the
 *     move that was just played, so an arrow along it is pure noise.
 *  2. Every arrow carries a `reason`. An arrow the explanation never mentions
 *     is a puzzle, not a hint — the reason makes an unexplained arrow easy to
 *     spot in review and in tests.
 */

import type { Arrow, ArrowGenerator, VisualInput } from './types';

export interface ArrowConfig {
  /** Cap so a busy position does not turn into spaghetti. */
  readonly maxArrows: number;
  /** Show the better move when one existed. */
  readonly showBestMove: boolean;
  /** Show arrows for tactics found in the move played. */
  readonly showPlayedMotifs: boolean;
  /** Show arrows for tactics that were missed. */
  readonly showMissedMotifs: boolean;
}

export const DEFAULT_ARROW_CONFIG: ArrowConfig = {
  maxArrows: 3,
  showBestMove: true,
  showPlayedMotifs: true,
  showMissedMotifs: true,
};

/** A rule contributes arrows. Add one to extend the vocabulary. */
export type ArrowRule = (input: VisualInput, config: ArrowConfig) => readonly Arrow[];

/**
 * The move the player should have made. Worth an arrow precisely BECAUSE it is
 * not on the board — the one case where a from→to arrow adds information.
 */
export const bestMoveArrowRule: ArrowRule = (input, config) => {
  if (!config.showBestMove) return [];
  const cmp = input.comparison;
  if (!cmp || cmp.isSameMove || cmp.best.length < 4) return [];
  return [{
    from: cmp.best.slice(0, 2),
    to: cmp.best.slice(2, 4),
    color: 'best',
    reason: 'The stronger move that was available.',
  }];
};

/** Tactics: what attacks what. */
export const motifArrowRule: ArrowRule = (input, config) => {
  const out: Arrow[] = [];
  for (const motif of input.motifs) {
    if (motif.source === 'played' && !config.showPlayedMotifs) continue;
    if (motif.source === 'best' && !config.showMissedMotifs) continue;
    const squares = motif.squares ?? [];
    const from = squares[0];
    if (!from) continue;
    // squares[0] is the piece doing the work; the rest are its targets.
    for (const target of squares.slice(1)) {
      out.push({
        from,
        to: target,
        color: motif.source === 'played' ? 'threat' : 'idea',
        reason: motif.source === 'played'
          ? `${motif.label}: ${from} hits ${target}.`
          : `${motif.label} was available from ${from}.`,
      });
    }
  }
  return out;
};

export const DEFAULT_ARROW_RULES: readonly ArrowRule[] = [bestMoveArrowRule, motifArrowRule];

export class DefaultArrowGenerator implements ArrowGenerator {
  constructor(
    private readonly rules: readonly ArrowRule[] = DEFAULT_ARROW_RULES,
    private readonly config: ArrowConfig = DEFAULT_ARROW_CONFIG,
  ) {}

  generate(input: VisualInput): readonly Arrow[] {
    const played = input.input.analysis.playedMove ?? '';
    const playedFrom = played.slice(0, 2);
    const playedTo = played.slice(2, 4);

    const seen = new Set<string>();
    const out: Arrow[] = [];
    for (const rule of this.rules) {
      let produced: readonly Arrow[] = [];
      try { produced = rule(input, this.config); } catch { produced = []; }
      for (const arrow of produced) {
        // Rule 1: never retrace the played move.
        if (arrow.from === playedFrom && arrow.to === playedTo) continue;
        const key = `${arrow.from}${arrow.to}${arrow.color}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(arrow);
        if (out.length >= this.config.maxArrows) return out;
      }
    }
    return out;
  }
}
