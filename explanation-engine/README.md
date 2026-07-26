# @gambit/explanation-engine

A modular engine that explains **why** a chess move was good or bad using chess
principles — not free-form AI text. This package is the **architecture core**:
interfaces, base classes, registry, selector and orchestrator. It ships with
**no concrete detectors** by design; chess knowledge is added incrementally by
registering detectors.

## Where it sits in the pipeline

```
PGN
 ↓                       (host app: PGN parser)
Stockfish Analysis
 ↓                       (host app implements the AnalysisProvider port)
Move Classification
 ↓                       (host app implements the MoveClassifier port)
──────────── this package ────────────
Explanation Engine
 ↓   registry → detectors → selector
User Explanation
```

Stages 1–3 already exist in the host (Gambit Chess Academy's Game Review has a
PGN parser, a Stockfish 18 bridge and a classifier). This package deliberately
contains **no engine I/O and no PGN parsing** — it consumes one fully-described
move at a time as a `MoveContext` and returns a `UserExplanation` (or `null`,
in which case the host falls back to the classifier's stock note).

## Core concepts

| Piece | File | Responsibility |
|---|---|---|
| `MoveContext` | `src/types.ts` | Everything knowable about one move (FENs, evals, classification, pre-computed mover-perspective deltas). Immutable by contract. |
| `Detector` / `BaseDetector` | `src/detector.ts` | One unit of chess understanding. Decides *applies?*, scores *confidence* (0–1), produces an *explanation* + *improvements*. `BaseDetector` owns result assembly, clamping and error containment so concrete detectors are pure chess logic. |
| `DetectorRegistry` | `src/registry.ts` | The extensibility point: `register()` one call per new detector. Enforces unique ids, filters by move classification, guarantees deterministic ordering. |
| `ExplanationSelector` | `src/selector.ts` | The priority system. Ranks all `DetectionResult`s: **tier → priority → confidence → id**. Picks one primary + N supporting. |
| `ExplanationEngine` | `src/engine.ts` | Pure plumbing: registry → detectors → selector → shaped `UserExplanation`. Contains no chess knowledge and no ranking logic. |

### The priority system (why a heuristic can never “win”)

Every detector declares a **tier**, chosen by its author:

- `certain` — provably true from the rules (e.g. the move was the only legal move);
- `verified` — confirmed by board geometry or the engine's PV (the piece *is*
  hanging, the fork *is* in the line);
- `heuristic` — best-effort judgement that may occasionally be wrong.

The selector ranks by tier **first**; a `heuristic` at confidence 0.99 still
loses to a `verified` at 0.5. Within a tier, the author-assigned `priority`
orders competing detectors, then per-move `confidence`, then id (a pure
determinism tie-break). This mirrors — and is enforced by — unit tests.

## Writing a detector (when the time comes)

```ts
import { BaseDetector, MoveContext } from '@gambit/explanation-engine';

export class HangingPieceDetector extends BaseDetector {
  readonly id = 'hanging-piece';
  readonly tier = 'verified' as const;      // board geometry, not guesswork
  override readonly priority = 10;          // outranks generic eval-drop talk
  override readonly classifications = ['mistake', 'blunder'] as const;

  protected appliesTo(ctx: MoveContext): boolean {
    // cheap structural test — is the moved piece en prise for nothing?
    ...
  }
  protected confidence(ctx: MoveContext): number { ... }        // 0–1
  protected explain(ctx: MoveContext) {
    return {
      headline: 'This leaves the bishop hanging.',
      detail: 'After the exchange on c5 the bishop has no defender…',
      tags: ['hanging-piece', 'material'],
    };
  }
  protected improvements(ctx: MoveContext) {
    return [{ moveSan: 'Be7', advice: 'Retreat and keep the piece defended.' }];
  }
}
```

Wire-up is one line — nothing else in the system changes:

```ts
registry.register(new HangingPieceDetector());
```

Guarantees the base class gives you:

- you never build a `DetectionResult` by hand (no duplicated assembly logic);
- confidence is clamped into `[0, 1]`; `0`/`NaN` degrade to “does not apply”;
- an exception thrown anywhere in your hooks becomes a clean non-application —
  one buggy detector can never break a game review.

## Using the engine

```ts
import { DetectorRegistry, ExplanationEngine, ExplanationSelector } from '@gambit/explanation-engine';

const registry = new DetectorRegistry();      // .register(...) real detectors here
const engine = new ExplanationEngine(registry, new ExplanationSelector({ maxSupporting: 1 }));

const explanation = engine.explainMove(moveContext);
if (explanation) {
  render(explanation.headline, explanation.detail, explanation.improvements);
} else {
  render(stockNoteForClassification(moveContext.classification));   // fallback
}
```

## Development

```bash
npm install
npm test        # tsc (strict) + node:test — 27 tests, no test-framework deps
npm run build   # emits dist/ (CommonJS + .d.ts)
```

## Design rules for contributors

1. **Detectors are pure and synchronous.** All engine I/O happens upstream;
   detection must be deterministic and unit-testable with a plain object.
2. **No duplicated logic.** Sign conversions and win% math live in `MoveDeltas`
   (upstream, computed once); result assembly lives in `BaseDetector`; ranking
   lives in `compareResults`. If you're re-implementing one of those, stop.
3. **Never throw across the boundary.** `BaseDetector` and the engine both
   contain errors; keep it that way.
4. **Tiers are about the method, not the moment.** If your technique can be
   wrong, it is `heuristic` — no matter how sure it feels on a given move.
