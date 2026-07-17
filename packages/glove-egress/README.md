# glove-egress

The one-eval-tool sandbox→context boundary makes an agent **context-efficient** —
only the value a program returns enters the model's context. `glove-egress` makes
that same boundary a **privacy** boundary, and gives you the instruments to
measure it.

Built on the [`glove-scratchpad`](../glove-scratchpad) fns catalog: the egress
combinators are ordinary `ToolFn`s, so they mount on any REPL surface
(`glove-js` / `glove-python` / `glove-lisp`).

## Why a separate package

The exfiltration study ([`benches/scratchpad-bench/EXFIL-PAPER.md`](../../benches/scratchpad-bench/EXFIL-PAPER.md))
reaches one structural conclusion: **a privacy boundary that depends on the
model's goodwill is not a boundary** — voluntary "return only decisions" priming
plateaued at a 33% leak rate; only *enforcement* reached 0%. The consequence is
that the enforcement belongs in the platform, not in a prompt and not
copy-pasted into each app. This package is that primitive. It is separated out —
rather than left in the benchmark, or folded into `glove-scratchpad` / the eval
surfaces — for three concrete reasons:

1. **It is the deliverable the research argues for.** The finding is "enforcement
   must be a platform primitive"; `egressFns` + `guardEffectFns` + `BoundaryMeter`
   *are* that primitive. Shipping only the benchmark would be shipping the
   evidence but not the thing the evidence recommends.
2. **It already has more than one consumer.** Both the exfiltration bench and the
   [support-desk](../../benches/support-desk) application bench import the
   `BoundaryMeter` to measure what crosses the boundary — shared-across-benches is
   the usual bar for lifting code out of one of them.
3. **It keeps security out of the ergonomics-focused core.** The eval surfaces and
   the `glove-scratchpad` fns catalog stay about *drivability*; the egress gate is
   a distinct, opt-in concern with its own narrow dependency surface (only
   `glove-scratchpad/fns`). Folding it in would tax every adopter who doesn't want it.

Honest status: `glove-egress` is consumed by the two benchmarks today, not yet by
a production deployment — it is the tested primitive the study concludes is
needed, ready for the first app that wants a **measured, enforced** egress
boundary.

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
