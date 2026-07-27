# @gambit/explanation-engine

A modular engine that explains **why** a chess move was good or bad using chess
principles — not free-form AI text. This package contains the **architecture
core** (interfaces, base classes, registry, selector, orchestrator) plus the
first concrete detector; further chess knowledge is added incrementally by
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
| board utilities | `src/board.ts` | Dependency-free FEN/UCI structural facts shared by all detectors (home squares, undeveloped minors, capture/castle/develop tests) **plus attack geometry** (`attacks`, `attackersOf`, `hangingPieces`) and **Static Exchange Evaluation** (`staticExchangeEval`). Not an engine — legality and pins stay upstream. |
| `DevelopmentDetector` | `src/detectors/development.ts` | Concrete detector (tier `heuristic`): opening-phase gate, missed development, wasted tempo, delayed castling — with confidence scoring and coaching tips. Its pure signal function `computeDevelopmentSignals` is exported for reuse. |
| `HangingPieceDetector` | `src/detectors/hanging-piece.ts` | Concrete detector (tier `verified`): hangs created by the played move (moved piece or piece left behind), and missed captures of free enemy material. Beginner-friendly wording + a counting habit as the coaching tip. Pure signals via `computeHangingSignals`. |
| `MaterialDetector` | `src/detectors/material.ts` | Concrete detector (tier `verified`): grades the move's trade with SEE — win-material / favorable / equal / unfavorable / lose-material — and splits an intentional **sacrifice** from a **blunder** using the engine's verdict (a brilliant/great classification, or a negligible win% drop). Pure signals via `computeMaterialSignals`. |
| `KingSafetyDetector` | `src/detectors/king-safety.ts` | Concrete detector (tier `heuristic`): missed castling, unnecessary king moves, weakened pawn shield, files opened beside the king, and a rising king-"danger" score — explained through their strategic consequences. King-safety model exposed as `analyzeKingSafety`; pure signals via `computeKingSafetySignals`. |
| tactics core | `src/tactics.ts` | `detectTactics` — pure motif geometry over two board snapshots, no move generation (mates come from the engine's score). Finds fork, pin, skewer, discovered attack/check, double attack, x-ray, back-rank, mate/mating-net (`verified`) and overloaded / deflection / decoy (`heuristic`). Each finding carries its own tier. |
| `TacticalDetector` + `TacticalMotifDetector` | `src/detectors/tactical.ts` | The tactic in the **engine's best move**, so it both praises a tactic you found and coaches one you missed. Split by tier into a `verified` detector and a `heuristic` one (register both with `tacticalDetectors()`) so a soft pattern can never speak over a proven tactic. |
| positional geometry | `src/positional.ts` | Reusable strategic primitives: `pieceMobility`, `isOpenFile`/`isSemiOpenFile`, `bishopQuality`, `isOutpostSquare`/`outpostSupported`, `rooksConnected`. |
| `PieceActivityDetector` | `src/detectors/piece-activity.ts` | Concrete detector (tier `heuristic`): rook-to-open-file, knight outpost, strong/bad bishop, connected rooks, activation, passive pieces, and missed activation — praising strong moves and flagging passive ones, always through the positional consequence. Pure signals via `computeActivitySignals`. |
| `PawnStructureDetector` | `src/detectors/pawn-structure.ts` | Concrete detector (tier `heuristic`): works on the structural CHANGE a move makes — praising a new passed pawn, connected passers, a wing majority, damage to the enemy skeleton, or a strong chain; flagging a self-inflicted isolated/doubled/backward pawn or a weak chain. Structural primitives (`isPassedPawn`, `isBackwardPawn`, `pawnChains`, `wingPawnCounts`, …) live in `positional.ts`. |
| `CenterControlDetector` | `src/detectors/center-control.ts` | Concrete detector (tier `heuristic`): measures the change in a mover's grip on d4/e4/d5/e5 — praising occupying the centre, a central pawn lever (`contest`), or a firm grip (`strong`); flagging surrendered control (`loss`) or a missed central break. Centre primitives (`CENTER_SQUARES`, `centralControlCount`, `isCentralLever`) in `positional.ts` / the detector. |
| `EndgameDetector` | `src/detectors/endgame.ts` | Concrete detector (tier `heuristic`, gated to `isEndgame`): promotion, promotion-threats, outside passed pawns, opposition (`haveDirectOpposition`), rook activity (seventh rank / behind a passer), king activity, pawn races, and fortress holds — plus a passive-king criticism. Pure signals via `computeEndgameSignals`. |

### Detector roster

| Detector | Tier | Priority | Classifications |
|---|---|---|---|
| `tactics` | `verified` | 30 | brilliant, great, best, good, inaccuracy, mistake, blunder, miss |
| `material` | `verified` | 22 | brilliant, great, best, good, inaccuracy, mistake, blunder |
| `hanging-piece` | `verified` | 20 | inaccuracy, mistake, blunder, miss |
| `tactics-pattern` | `heuristic` | 9 | brilliant, great, best, good, inaccuracy, mistake, blunder, miss |
| `king-safety` | `heuristic` | 8 | inaccuracy, mistake |
| `piece-activity` | `heuristic` | 7 | great, best, good, inaccuracy, mistake |
| `pawn-structure` | `heuristic` | 6 | great, best, good, inaccuracy, mistake |
| `center-control` | `heuristic` | 6 | great, best, good, inaccuracy, mistake |
| `endgame` | `heuristic` | 6 | great, best, good, inaccuracy, mistake |
| `development` | `heuristic` | 5 | inaccuracy, mistake, good |

Because tier beats everything, a proven tactic or material fact always leads the
explanation and a principle/pattern note rides along as supporting text — never
the other way round.

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
