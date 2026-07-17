# scratchpad-bench

An **agentic A/B benchmark**: does exposing an agent's capabilities as a
`glove-scratchpad` SQL database (one `execute_sql` tool) actually beat wiring the
same capabilities up as ordinary MCP tools — on real models, on real
multi-service tasks?

> 📄 **Read the full write-up: [The Scratchpad Is a Database](PAPER.md)** — the
> complete study with figures: the A/B results, the 74% → 100% weak-model
> hardening arc, the Postgres-parity audit, the OSS-frontier/cheap-model roster,
> and the design principles that fell out.

It stands up **ten in-process MCP servers** mirroring a real product team's stack
(GitHub, Linear, Email, Slack, Notion, Jira, Sentry, PagerDuty, Calendar,
Filesystem — 32 tools over one deterministic, cross-linked seed world) and runs
each task twice against the **same servers and the same model**:

| arm | tool surface | how data enters context |
| --- | --- | --- |
| **baseline** | all 32 MCP tools folded directly (`bridgeMcpTool`) | every tool result streams back verbatim |
| **scratchpad** | a single `execute_sql` (+ `explain_sql`) over the same capabilities as SQL tables | only the rows a `SELECT` returns |
| **lisp** | a single `execute_lisp` (+ `explain_lisp`) over the same capabilities as functions in a persistent Clojure-flavored REPL ([`glove-lisp`](../../packages/glove-lisp)) | only the last form's (elided) value; `def` keeps intermediates in the session |

All arms are driven by the real `glove-core` agent loop; nothing is mocked above
the MCP protocol boundary. The scratchpad arm exercises the shipping engine end to
end — `information_schema` discovery, WHERE-pushdown / required-key resolution,
cross-service JOINs and `INSERT … SELECT`, transaction staging.

The lisp arm is a follow-on exploration — see
[**Is the Scratchpad a REPL?**](LISP-EXPLORATION.md) for the hypothesis
(branching in one call, exactly-once effects by construction, free
inspectability) and its no-API-key validation
(`pnpm --filter glove-scratchpad-bench probe:lisp` drives all seven scenarios
through the Lisp surface). It is opt-in:
`pnpm bench --arms=baseline,scratchpad,lisp`.

A separate **frame A/B** ([**Is a workflow just a renamed REPL?**](FRAME-PAPER.md))
reuses this whole layer to ask a narrower question: holding the runtime, catalog,
scenarios, and models fixed, does *renaming* the one eval tool
(`execute_js` → `execute_js_workflow`) and de-REPLing its priming make a model
author the whole task as **one program** instead of degrading the surface into an
incremental tool-call loop? It measures eval calls per task, single-call rate, and
pass rate across the three framings (`repl` / `program` / `workflow`):
`pnpm --filter glove-scratchpad-bench frame-bench` (no-API validation:
`frame-selfcheck`).

A further **exfiltration bench**
([**The Boundary Is the Guarantee**](EXFIL-PAPER.md)) turns the same off-context
surface into a **privacy boundary** and tests it. It first settles the *ruler*
question by construction — Shannon "bits crossed" is a throughput headline, not a
safety bound; min-entropy / g-leakage (QIF) plus empirical canary extraction are
the right instruments, and the composition bound is a min-entropy budget, *not*
differential privacy. It then salts the seed world with **canary secrets** and
grades, deterministically, whether a benign task leaks a secret sitting next to
its answer — across `raw-mcp` / `repl` / `workflow` / `gate`, where `gate` is an
**enforced egress gate** (the eval tool refuses to return a raw value; only
`assert`/`count`/`choose`/`bucket`/`report` decisions cross, metered against a
bit budget, with outbound effects allowlisted). A delegated-judge tier removes
the document from the planner entirely. No-API validation of the whole metric /
canary / gate / red-team layer: `pnpm --filter glove-scratchpad-bench
exfil-selfcheck`; the paid arms: `exfil-bench --budget=<usd>`.

## What's measured

Per (model × scenario × arm) run, from the agent's own event stream:

- **turns** — model round-trips
- **tool calls** — model-visible invocations (`tool_use_result`)
- **MCP round-trips** — underlying `tools/call`s (ground-truth meter)
- **peak context** — largest single-call prompt = peak context-window occupancy
- **tokens in/out**, **compactions**, **wall time**, **estimated cost**
- **pass/fail** — graded deterministically against the seed world (writes are
  graded on the real side effect — the outbox — which can't be faked)

## Layout

```
src/
  mcp/
    seed.ts             # one deterministic, cross-linked org (PRNG-seeded)
    spec.ts             # unified per-service spec → MCP tools + scratchpad tables
    inprocess.ts        # real McpServer over InMemoryTransport → McpServerConnection
    servers/*.ts        # the 10 services
    index.ts            # buildMockOrg(): world + connections + resources
  harness/
    instrument.ts       # SubscriberAdapter → metrics + JSONL transcript
    arms.ts             # baseline vs scratchpad builders
    runner.ts           # one cell: build → run → grade → metrics
  scenarios.ts          # tasks + deterministic verifiers
  models.ts             # OpenRouter model roster (cheapest tool-capable per family)
  run.ts                # CLI + summary/CSV/Markdown writers
  selfcheck.ts          # no-API validation of the whole MCP+scratchpad layer
  probe.ts              # no-API mechanics probes (INSERT…SELECT, required-key IN, JOIN)
  exfil/
    meter.ts            # boundary meter: Shannon / min-entropy / g-leakage + canary extraction
    canaries.ts         # canary seeding into the world + scanner + judge corpus
    gate.ts             # the enforced egress gate (return whitelist + effect allowlist)
    redteam.ts          # adaptive-extraction + bit-budget + anomaly simulation (no API)
    scenarios.ts        # temptation / injection / judge tasks + deterministic verifiers
    judge.ts            # delegated cheap-model classifier fn (judge tier)
    arms.ts             # raw-mcp / repl / workflow / gate / self-judge / delegate-judge
    selfcheck.ts        # no-API validation of the whole exfil layer
  exfil-bench.ts        # exfil CLI + runner + writers
  exfil-figures.ts      # SVG figures for EXFIL-PAPER.md
logs/                   # per-cell JSONL transcripts (git-tracked)
results/                # agentic-summary.md + agentic-results.{json,csv} (git-tracked)
```

## Running

Needs `OPENROUTER_API_KEY` in the repo-root `.env` (loaded via `--env-file`).

```bash
# no API key — validate the whole layer and the engine mechanics:
pnpm --filter glove-scratchpad-bench selfcheck
npx tsx src/probe.ts

# the benchmark (guard your spend with --budget, in USD):
pnpm --filter glove-scratchpad-bench bench --budget=1.50
pnpm --filter glove-scratchpad-bench bench --models=deepseek,glm --scenarios=count-open-prs --arms=baseline,scratchpad
```

Flags: `--models`, `--scenarios`, `--arms`, `--budget`, `--scale` (world size),
`--maxTurns`, `--maxTokens`, `--contextLimit` (compaction threshold), `--timeout`,
`--echo`.

## Bugs this benchmark caught (and fixed in the product)

- **`glove-sql` — `INSERT … SELECT` column corruption.** A projection of
  same-named columns (`SELECT 'acme/web', 'Verify: '||title`, both inferring
  `?column?`) collapsed onto one object key, so the literal was dropped and the
  wrong value landed in every target column. Fixed by de-duplicating output column
  names in `projectRow` / `outputColumns` / `projectAggregate`
  (`packages/glove-sql/src/index.ts`). Also fixes `SELECT *` across joined tables
  that share a column name.
- **`glove-scratchpad` — leaked ephemeral table.** A virtual table left behind by
  a partially-failed materialization (CREATE ok, bulk INSERT throws) made the next
  statement's CREATE fail with "relation already exists" — a valid query dying
  under the model and triggering a panic-thrash. Fixed: track for teardown before
  materializing + `DROP IF EXISTS` before CREATE (idempotent).
- **Required-key `IN (…)` under-fetch (authoring footgun).** A get-by-key tool
  exposed as a table resolved only the first value of `WHERE id IN (a,b,c)`; fixed
  with an explicit `fanOut` in the resource spec.

Engine tests: glove-sql 84/84, glove-scratchpad 40/40 (regression tests added).

## Hardening the scratchpad for weak models

Driven by this benchmark, `glove-scratchpad` gained anti-spiral discipline in the
primed preamble (a single write fires directly; be decisive) plus a primed table
catalog **with enum values surfaced**. On the five weak OpenRouter models this
moved the scratchpad arm from **74% → 97% pass, spirals 6 → 0, median tool calls
6 → 2, avg turns 11 → 3.5**.

It also drove **read-your-writes** (`DatabasePolicy.readYourWrites`, default on):
agents reflexively re-read their own writes, so instead of forbidding it, the
database now folds each session's fired INSERT/UPDATE/DELETEs back over live reads
of the same table — a re-query returns the write, killing the read-after-write
spiral at the source (upstream stays a live view; the session is read-your-writes).
Proven by `probe.ts [D]` and 7 unit tests.

Finally, a multi-agent **database-parity audit**
([`results/PARITY-AUDIT.md`](results/PARITY-AUDIT.md)) drove five batches of
`glove-sql`/`glove-scratchpad` fixes so the emulator behaves like a real Postgres
to a droid — it now **errors where Postgres errors** instead of silently
mis-answering (fixed an inverted boolean comparison, `+`-on-text, unknown-column →
NULL, case-sensitive identifiers), gained a `string_agg`/`date_trunc` function
library, `INSERT … RETURNING`, `is_nullable`/enum discovery via
`information_schema`, and transaction auto-rollback. This took the weak-model
scratchpad arm to **35/35 (100%)** — full arc **v1 74% → v3 97% → v5 100%**. See
[`results/FINDINGS.md`](results/FINDINGS.md).

## Results

See [`results/agentic-summary.md`](results/agentic-summary.md) (regenerated on
every run) and the per-cell transcripts under [`logs/`](logs). The older
`results.md` / `results.csv` in this folder are a separate *deterministic*
byte-reduction measurement (no model) and are kept for reference.
