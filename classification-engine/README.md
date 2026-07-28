# @gambit/classification-engine

Turns one Stockfish-analysed move into a labelled verdict. This is **stage 3**
of the review pipeline — the stage the explanation engine has always assumed
exists upstream.

```
PGN → Stockfish → [ Move Classification ] → Explanation Engine → UI
```

```ts
import { MoveClassifier } from '@gambit/classification-engine';

const classifier = new MoveClassifier();
const verdict = classifier.classify(analysis);
// { classification: 'Blunder', confidence: 0.93, reasons: [...], metadata: {...} }
```

## Why win probability, not centipawns

Every band is expressed in **win probability lost**, never raw centipawns.
Going from +100 to 0 is a disaster; going from +900 to +800 is nothing — yet
both are "100 centipawns". Win% is the scale on which a human experiences a
mistake, so it is the scale the engine grades on. The model is a configurable
logistic curve (`k`, default lichess-style 0.00368).

## Architecture

| Piece | File | Responsibility |
|---|---|---|
| `MoveAnalysis` / `MoveClassification` | `src/types.ts` | The input contract and the verdict. All scores are WHITE-point-of-view by convention. |
| `ClassifierConfig` | `src/config.ts` | **Every tunable number.** No threshold may live anywhere else. |
| `winProbability` | `src/win-probability.ts` | Centipawns → win%. Mate scores short-circuit the curve. |
| `ClassificationContext` | `src/context.ts` | Derived metrics, computed once: win% before/after/drop, sacrifice size, only-move, gap to second best, ply. The white→mover sign conversion happens here exactly once. |
| `ClassificationRule` | `src/rule.ts` | The contract. One rule = one reason a move earns a label. |
| rules | `src/rules/*.ts` | The chess knowledge. |
| `MoveClassifier` | `src/classifier.ts` | Plumbing: build context → ask rules in priority order → shape the winner. Owns no thresholds and no chess knowledge. |

## Precedence

Rules are asked in priority order and the first to claim the move wins. The
order encodes a teaching decision — the most *informative* label wins, not the
most flattering:

| Priority | Rule | Verdict | Why it ranks there |
|---|---|---|---|
| 100 | `BookRule` | `Book` | Theory. Grading it teaches nothing. |
| 90 | `ForcedRule` | `Forced` | No choice existed, so quality is meaningless. |
| 80 | `BrilliantRule` | `Brilliant` | Rarest and most informative. |
| 70 | `GreatRule` | `Great` | The only move that held the position. |
| 60 | `MissRule` | `Miss` | A win thrown away is a different lesson from a bad move. |
| 50 | `BestRule` | `Best` | Engine's first choice, nothing rarer to say. |
| 0 | `QualityBandRule` | `Excellent`…`Blunder` | Catch-all. **Never returns null**, so every move gets a label. |

### Guards that keep labels meaningful

- **Brilliant** requires *all* of: real material given up (measured on the
  board, never inferred from the score), still (near-)best, still winning
  afterwards, past the opening, and a deep enough search. Each condition rules
  out a specific false positive — notably "a brilliant move that leaves you
  lost", which is a blunder with style.
- **Great** needs MultiPV to know the gap to the second-best move. Without it
  the rule *declines* rather than guessing.
- **Miss** fires on a forced mate let go regardless of the numbers.

## Configuration

No business logic contains a magic number. Retuning is a config object:

```ts
const strict = new MoveClassifier({
  quality: { excellent: 1, good: 3, inaccuracy: 7, mistake: 15 },
  brilliant: { minSacrificeCp: 300 },
});
```

Omitted sections keep their defaults. This is what makes per-rating-band tuning
or an A/B test possible without touching code.

## Extending

Adding a verdict means adding a rule — no existing file changes:

```ts
class TimeTroubleRule implements ClassificationRule {
  readonly id = 'time-trouble';
  readonly priority = 65;
  evaluate(ctx) { /* … */ return null; }
}

new MoveClassifier({}, [new TimeTroubleRule(), ...defaultRules()]);
```

A rule that throws is skipped, never propagated — one bad rule cannot take down
a game review.

## Output

`metadata` always carries `ruleId`, so any verdict in production can be traced
to the rule that produced it, plus the derived numbers behind the decision.
`confidence` is reduced when the search was shallow, and drops near a band edge
where a slightly deeper search might have produced a different label.

## Development

```bash
npm install
npm test        # tsc (strict) + node:test — 29 tests, no test-framework deps
```
