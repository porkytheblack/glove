# scratchpad-bench

An **agentic A/B benchmark**: does exposing an agent's capabilities as a
`glove-scratchpad` SQL database (one `execute_sql` tool) actually beat wiring the
same capabilities up as ordinary MCP tools — on real models, on real
multi-service tasks?

It stands up **ten in-process MCP servers** mirroring a real product team's stack
(GitHub, Linear, Email, Slack, Notion, Jira, Sentry, PagerDuty, Calendar,
Filesystem — 32 tools over one deterministic, cross-linked seed world) and runs
each task twice against the **same servers and the same model**:

| arm | tool surface | how data enters context |
| --- | --- | --- |
| **baseline** | all 32 MCP tools folded directly (`bridgeMcpTool`) | every tool result streams back verbatim |
| **scratchpad** | a single `execute_sql` (+ `explain_sql`) over the same capabilities as SQL tables | only the rows a `SELECT` returns |

Both arms are driven by the real `glove-core` agent loop; nothing is mocked above
the MCP protocol boundary. The scratchpad arm exercises the shipping engine end to
end — `information_schema` discovery, WHERE-pushdown / required-key resolution,
cross-service JOINs and `INSERT … SELECT`, transaction staging.

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

## Bugs this benchmark caught

- **`glove-sql` — `INSERT … SELECT` column corruption.** A projection of
  same-named columns (`SELECT 'acme/web', 'Verify: '||title`, both inferring
  `?column?`) collapsed onto one object key, so the literal was dropped and the
  wrong value landed in every target column. Fixed by de-duplicating output column
  names in `projectRow` / `outputColumns` / `projectAggregate`
  (`packages/glove-sql/src/index.ts`). Also fixes `SELECT *` across joined tables
  that share a column name. (80/80 engine tests still green.)
- **Required-key `IN (…)` under-fetch (authoring footgun).** A get-by-key tool
  exposed as a table resolved only the first value of `WHERE id IN (a,b,c)`
  because the default binding uses `.one()`. Here it's handled with an explicit
  `fanOut` in the resource spec (`src/mcp/spec.ts`) — the correct pattern for
  turning a single-fetch tool into an `IN`-queryable table.

## Results

See [`results/agentic-summary.md`](results/agentic-summary.md) (regenerated on
every run) and the per-cell transcripts under [`logs/`](logs). The older
`results.md` / `results.csv` in this folder are a separate *deterministic*
byte-reduction measurement (no model) and are kept for reference.
