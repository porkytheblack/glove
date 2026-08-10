---
"glove-working-environment": minor
"glove-core": patch
---

A telemetry seam, and a way for adapters to let go of what they hold.

- **`onVerb({ name, ok, durationMs, mutated })`** — per-verb timing, and a reliable answer to "did the tree change". `mutated` is measured rather than inferred from the verb's name: the hand-maintained list both examples kept drifts when a verb is added, ignores `toolsWithPrefix` entirely, and cannot tell a `run_script` that wrote a file from one that only read.
- **`EnvTool.mutates`** carries the static answer, so a host never needs its own list.
- **`env.counters`** — live `limitHits`, `spillovers` and `mutations` for a dashboard.
- **`tool_use_result` carries `duration_ms`** (glove-core), so per-tool latency needs no wrapper around every folded tool.
- **`StdlibAdapter.close()`**, awaited by `env.close()` after the worker pool is down. `env:motion` keeps a browser warm between renders; without this the only ways it came back were an idle timer or process exit, so a host closing fifty environments in a loop held fifty browsers. A `close` that throws is reported through `execution.onWarning` and does not fail the shutdown.

Fixes a defect found while testing the counters: the spillover path refused its own write on a small `maxFileBytes`. It truncated to exactly the cap and then appended its marker, and counted both in characters against a cap measured in bytes (`…` alone is three). The model was told its output was too big to show *and* too big to save — the one outcome spillover exists to prevent.
