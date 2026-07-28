/**
 * Module 6 — HighlightGenerator.
 *
 * Squares worth lighting up, as data. Separate from {@link ./arrow-generator}
 * because they answer different questions — an arrow says "this hits that", a
 * highlight says "look here" — and a host may well want one without the other.
 *
 * Same discipline as arrows: every highlight carries a reason, so a square lit
 * for no stated purpose is easy to catch.
 */

import type { Highlight, HighlightGenerator, VisualInput } from './types';

export interface HighlightConfig {
  readonly maxHighlights: number;
  /** Light the squares a theme points at (central squares, the outpost, …). */
  readonly showThemeSquares: boolean;
  /** Light the pieces involved in a tactic. */
  readonly showMotifSquares: boolean;
  /** Light the destination of the better move. */
  readonly showBestDestination: boolean;
}

export const DEFAULT_HIGHLIGHT_CONFIG: HighlightConfig = {
  maxHighlights: 4,
  showThemeSquares: true,
  showMotifSquares: true,
  showBestDestination: true,
};

export type HighlightRule = (input: VisualInput, config: HighlightConfig) => readonly Highlight[];

/** Where the better move was heading. */
export const bestSquareRule: HighlightRule = (input, config) => {
  if (!config.showBestDestination) return [];
  const cmp = input.comparison;
  if (!cmp || cmp.isSameMove || cmp.best.length < 4) return [];
  return [{ square: cmp.best.slice(2, 4), color: 'best', reason: 'Where the stronger move was going.' }];
};

/** Pieces caught up in a tactic — the danger, when it is the move played. */
export const motifSquareRule: HighlightRule = (input, config) => {
  if (!config.showMotifSquares) return [];
  const out: Highlight[] = [];
  for (const motif of input.motifs) {
    for (const square of (motif.squares ?? []).slice(1)) {
      out.push({
        square,
        color: motif.source === 'played' ? 'threat' : 'idea',
        reason: `Involved in the ${motif.label.toLowerCase()}.`,
      });
    }
  }
  return out;
};

/** Squares that evidence a strategic theme. */
export const themeSquareRule: HighlightRule = (input, config) => {
  if (!config.showThemeSquares) return [];
  const out: Highlight[] = [];
  for (const theme of input.themes) {
    for (const square of theme.squares ?? []) {
      out.push({ square, color: 'idea', reason: `${theme.label}.` });
    }
  }
  return out;
};

export const DEFAULT_HIGHLIGHT_RULES: readonly HighlightRule[] = [
  motifSquareRule,
  bestSquareRule,
  themeSquareRule,
];

export class DefaultHighlightGenerator implements HighlightGenerator {
  constructor(
    private readonly rules: readonly HighlightRule[] = DEFAULT_HIGHLIGHT_RULES,
    private readonly config: HighlightConfig = DEFAULT_HIGHLIGHT_CONFIG,
  ) {}

  generate(input: VisualInput): readonly Highlight[] {
    // First rule to claim a square wins, so the ordering above is a priority
    // order: a square in a tactic matters more than the same square in a theme.
    const claimed = new Set<string>();
    const out: Highlight[] = [];
    for (const rule of this.rules) {
      let produced: readonly Highlight[] = [];
      try { produced = rule(input, this.config); } catch { produced = []; }
      for (const highlight of produced) {
        if (claimed.has(highlight.square)) continue;
        claimed.add(highlight.square);
        out.push(highlight);
        if (out.length >= this.config.maxHighlights) return out;
      }
    }
    return out;
  }
}
