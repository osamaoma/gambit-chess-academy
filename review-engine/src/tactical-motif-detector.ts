/**
 * Module 3 — TacticalMotifDetector.
 *
 * An adapter, not a reimplementation. Motif geometry (forks, pins, skewers,
 * discovered attacks, back-rank patterns) already exists and is well tested in
 * `@gambit/explanation-engine`; duplicating it here would mean two copies to
 * keep in agreement. This module's own responsibility is narrower and real:
 * deciding WHOSE move to examine and labelling the result accordingly.
 *
 * It looks at both moves, because a review needs both halves of the story:
 *  - `played` — the tactic you found;
 *  - `best`   — the tactic that was there and you missed.
 *
 * That distinction is the module's whole reason to exist. Without it a review
 * cheerfully reports a pin you never played, which reads as a plain falsehood.
 */

import { applyUciMove, detectTactics } from '@gambit/explanation-engine';
import type { Board, TacticFinding } from '@gambit/explanation-engine';
import type { Motif, ReviewInput, TacticalMotifDetector } from './types';

export interface MotifConfig {
  /** Ignore findings below this confidence — keeps noise out of the review. */
  readonly minConfidence: number;
  /** Also examine the engine's move to report what was missed. */
  readonly includeMissed: boolean;
}

export const DEFAULT_MOTIF_CONFIG: MotifConfig = {
  minConfidence: 0.5,
  includeMissed: true,
};

export class DefaultTacticalMotifDetector implements TacticalMotifDetector {
  constructor(private readonly config: MotifConfig = DEFAULT_MOTIF_CONFIG) {}

  detect(input: ReviewInput): readonly Motif[] {
    const { analysis, boards } = input;
    const out: Motif[] = [];

    // What the player actually did.
    for (const f of this.findingsFor(boards.before, analysis.playedMove, analysis.mateAfter, analysis.principalVariation)) {
      out.push(toMotif(f, 'played'));
    }

    // What was available instead. Only meaningful when they differ.
    const differs = analysis.bestMove && analysis.bestMove.slice(0, 4) !== analysis.playedMove.slice(0, 4);
    if (this.config.includeMissed && differs) {
      for (const f of this.findingsFor(boards.before, analysis.bestMove, analysis.mateBefore, analysis.principalVariation)) {
        out.push(toMotif(f, 'best'));
      }
    }

    return out
      .filter((m) => m.confidence >= this.config.minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Run the shared geometry for one candidate move; never throw into the pipeline. */
  private findingsFor(
    before: Board,
    uci: string,
    mateIn: number | null,
    pv: readonly string[],
  ): readonly TacticFinding[] {
    if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(uci ?? '')) return [];
    try {
      const after = applyUciMove(before, uci);
      return detectTactics(before, after, uci, { mateIn, pv });
    } catch {
      return [];
    }
  }
}

function toMotif(f: TacticFinding, source: 'played' | 'best'): Motif {
  const squares = [f.from, ...(f.targets ?? [])].filter((s): s is string => !!s);
  return {
    id: f.id,
    label: f.label,
    confidence: f.confidence,
    source,
    ...(squares.length > 0 ? { squares } : {}),
  };
}
