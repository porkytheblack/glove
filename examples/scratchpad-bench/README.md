# Context-reduction benchmark — no API key, $0

The Scratchpad Computer's headline claim is **context reduction**, and that metric
is **deterministic**: it's a property of the data shapes and the workflow, not of
any model. So you can measure it with **zero model calls**. This harness runs the
*actual* scratchpad operations — contain each provider's payload → narrow it in
SQL → JOIN across providers → materialize a small answer — over seeded data, and
reads, via the real consumption tracker, the bytes that cross the model boundary:

```
naive      = the raw payloads a tool-calling agent would carry in-context
scratchpad = stubs + narrowing/join query reads + the last-mile materialize
reduction  = naive / scratchpad     (dimensionless — exact in bytes; tokens ≈ bytes/4)
```

```bash
pnpm scratchpad:bench   # ~5s, no API key; writes results.md + results.csv
```

## Results

### Reduction vs payload size (5 providers, 100 accounts)

| rows / provider | naive (KB) | scratchpad (KB) | **reduction** | naive (est. tok) | scratchpad (est. tok) |
|---|---:|---:|:---:|---:|---:|
| 100 | 79.3 | 22.0 | **3.6×** | 20.3k | 5.6k |
| 500 | 396.1 | 22.5 | **17.6×** | 101.4k | 5.8k |
| 1,000 | 792.1 | 22.6 | **35.0×** | 202.8k | 5.8k |
| 5,000 | 3,962.3 | 22.7 | **174.5×** | 1,014.3k | 5.8k |
| 20,000 | 15,845.9 | 22.8 | **696.1×** | 4,056.6k | 5.8k |
| 50,000 | 39,612.3 | 22.9 | **1,731.2×** | 10,140.7k | 5.9k |

The scratchpad's context cost stays **flat** (~22 KB) as the payload grows, so the
reduction factor grows ~linearly with payload size.

### Reduction vs provider count (1,000 rows each, 100 accounts)

| providers | naive (KB) | scratchpad (KB) | **reduction** | naive (est. tok) | scratchpad (est. tok) |
|---|---:|---:|:---:|---:|---:|
| 1 | 158.4 | 4.5 | **35.4×** | 40.5k | 1.1k |
| 2 | 316.8 | 9.6 | **33.0×** | 81.1k | 2.5k |
| 3 | 475.3 | 13.9 | **34.1×** | 121.7k | 3.6k |
| 5 | 792.1 | 22.6 | **35.0×** | 202.8k | 5.8k |
| 10 | 1,584.3 | 44.3 | **35.7×** | 405.6k | 11.3k |

The reduction is **invariant to provider count** — naive and scratchpad both scale
linearly with breadth — so the architecture composes across many MCP providers
without eroding the saving.

## What this is (and isn't)

- **It measures the reduction the architecture *enables*** when the workflow
  follows the narrow→materialize discipline the priming induces. That's the design
  target / upper bound, measured exactly.
- **It is not a model evaluation.** Whether a *real* model realizes the reduction
  is a separate, behavioral question — answered by the live runs in
  [`scratchpad-mcp-fleet`](../scratchpad-mcp-fleet) and
  [`scratchpad-mcp-workflow`](../scratchpad-mcp-workflow), where Kimi (via
  OpenRouter) drives the same workflow to the correct answer at 30–46×. The
  deterministic upper bound here is thus *achieved* in practice.
- Token counts use a ~4-bytes/token estimate; the **reduction factor is exact**
  (a ratio of measured byte counts, independent of the estimator).

Re-run `pnpm scratchpad:bench` to regenerate `results.md` / `results.csv` (seeded,
so the numbers are stable across runs).
