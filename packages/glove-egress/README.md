# glove-egress

The one-eval-tool sandbox→context boundary makes an agent **context-efficient** —
only the value a program returns enters the model's context. `glove-egress` makes
that same boundary a **privacy** boundary, and gives you the instruments to
measure it.

Built on the [`glove-scratchpad`](../glove-scratchpad) fns catalog: the egress
combinators are ordinary `ToolFn`s, so they mount on any REPL surface
(`glove-js` / `glove-python` / `glove-lisp`).

## Three layers

### 1. QIF metering — pick the right ruler

The intuitive "an assertion collapses a k-way read to log₂k bits" is Shannon
information, and **Shannon is the wrong safety ruler** — it averages a
catastrophic reveal away. `glove-egress` gives you all three:

```ts
import { BoundaryMeter, minEntropyLeak, gLeak } from "glove-egress";

const meter = new BoundaryMeter();
meter.cross("read", record);            // record every value that crosses
meter.cross("assertion", true, { decisionSpace: 2 });
const r = meter.report(canaries);        // { bytesCrossed, bitsCrossed,
                                         //   canariesRecovered, secretBitsRecovered, ... }
```

- **Shannon self-information** (`selfInfo`, `contentBits`) — a throughput headline.
- **min-entropy / g-leakage** (`minEntropyLeak`, `gLeak`) — the one-guess /
  coarse-win risk, the security-grounded bound.
- **empirical canary extraction** (`BoundaryMeter.report`) — the operational
  ground truth: which exact secrets crossed.

### 2. The enforced egress gate — only decisions leave

Priming a model to "return only decisions" is a discount, not a boundary. The
gate makes it structural: a program must end in a **decision** built by an egress
combinator, whose codomain is bounded by construction.

```ts
import { egressFns, guardEffectFns, DEFAULT_EGRESS_POLICY } from "glove-egress";

session.registerAll(egressFns(DEFAULT_EGRESS_POLICY));   // assert/count/choose/bucket/report
const guarded = guardEffectFns(catalog, DEFAULT_EGRESS_POLICY, onBlock); // effect allowlist
```

- `assert({label, cond})` → one bit · `count({label, n})` → an integer ·
  `choose({label, value, from})` → one member of a small set ·
  `bucket({label, hist})` → a k-anonymity-suppressed histogram ·
  `report({label, text})` → short prose with credential/PII tokens redacted.
- A per-session **min-entropy bit budget** caps cumulative disclosure (QIF
  composition — *not* differential privacy; a deterministic authoritative bit has
  unbounded ε).
- `guardEffectFns` blocks an outbound effect to an off-org recipient or carrying a
  secret-shaped payload.

The gate refuses raw returns; wiring it onto a specific eval tool (e.g. a
`glove-js` `execute_js` that must return a decision) is a few lines — see
`benches/scratchpad-bench/src/exfil/arms.ts`.

### 3. Red-team simulation

```ts
import { simulateExtraction, residualGuarantee } from "glove-egress";

simulateExtraction({ N: 1024, secret: 733, strategy: "binary" });          // pins in ~10 queries
simulateExtraction({ N: 1024, secret: 733, strategy: "binary", budgetBits: 4 }); // halts; ≥64 candidates remain
```

## The study

The design and its evaluation — Shannon vs min-entropy, canaries, four egress
disciplines with real models, and the delegated-judge tier — are written up in
[`benches/scratchpad-bench/EXFIL-PAPER.md`](../../benches/scratchpad-bench/EXFIL-PAPER.md)
("The Boundary Is the Guarantee").
