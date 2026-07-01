# Findings — scratchpad-bench

Qualitative companion to the auto-generated [`agentic-summary.md`](agentic-summary.md).
Everything below is reproducible from the seed world (`--seed=1337`) and the
per-cell transcripts in [`../logs`](../logs). Deterministic mechanics were
confirmed with `src/probe.ts` (no API).

## Bugs caught and fixed

### 1. `glove-sql` — `INSERT … SELECT` dropped/duplicated columns (real engine bug)

`INSERT INTO github_issues (repo, title) SELECT 'acme/web', 'Verify: ' || title FROM …`
committed rows where **`repo` held the title expression and the `'acme/web'`
literal was gone**. Root cause: result rows are objects keyed by column name, and
both unnamed projections inferred the name `?column?`; the second overwrote the
first, so the positional value mapping in `insertRows` read the same key twice.

This corrupts any query with duplicate output names, not just this INSERT —
`SELECT 'a','b'`, `SELECT count(*), count(*)`, and `SELECT *` across joined tables
sharing a column name all lost values.

**Fix:** de-duplicate output column names (`x`, `x` → `x`, `x_2`) in one shared
helper used by `projectRow`, `outputColumns`, and `projectAggregate`
(`packages/glove-sql/src/index.ts`). 4 regression tests added; **84/84 glove-sql
tests pass**. Verified end to end with `probe.ts` [A]: 9 selected rows → 9 issues
with `repo='acme/web'` and the correct title.

### 2. Required-key `IN (…)` under-fetch (authoring footgun)

A get-by-key tool exposed as a table (`linear_issue`, required key `id`) resolved
only the **first** value of `WHERE id IN (a,b,c)` — the default binding uses
`.one()`. A model that writes `IN` over three ids silently gets one row.

**Fix (authoring side):** the resource spec grew a `fanOut` option
(`src/mcp/spec.ts`) that invokes the underlying single-fetch tool once per bound
value and unions the rows. `probe.ts` [B]: 3 ids → 3 rows. The general lesson —
a single-fetch tool surfaced as an `IN`-queryable table must fan out — applies to
`resourceFromTool`'s defaults too.

## UX frictions (not bugs — worth knowing)

Observed in transcripts, most sharply in weaker models and the write scenarios:

- **Read-after-write on virtual tables.** Scratchpad tables are *live views*: a
  sent `emails` row (fired to the outbox) does **not** appear in a later
  `SELECT … FROM emails` (which re-runs the inbox list). Models that try to
  *verify* a write by re-querying spiral — deepseek burned 25 tool calls / 26
  turns on `email-top-error` chasing a row that would never show up, vs 2 tool
  calls in the baseline. Mitigation worth trying: state in the preamble that the
  `COMMIT` confirmation is authoritative and a write won't reflect in reads of the
  same table.
- **Transaction lifecycle.** `BEGIN` without a matching `COMMIT`/`ROLLBACK` before
  the next statement raises "a transaction is already open"; some models forget.
- **Discovery overhead is real.** On a trivial single-service question
  (`SELECT count(*) …`) the scratchpad model spends 2–3 extra turns walking
  `information_schema` before it can answer, while the baseline calls the one
  obvious tool immediately.

## The shape of the result

Main matrix: 5 models × 7 scenarios × 2 arms = 70 runs, `scale=2`,
`contextLimit=100k`, `maxTurns=30`, total spend ~$0.16.

Per-scenario medians (n = 5 models per arm):

| scenario | base peak | scr peak | ctx win | base tool-calls | scr tool-calls | base ✓ | scr ✓ |
|---|--:|--:|:--:|--:|--:|:--:|:--:|
| count-open-prs | 6518 | 1482 | **4.4×** | 1 | 3 | 3/5 | 5/5 |
| sentry-billing-unresolved | 3669 | 1516 | 2.4× | 1 | 3 | 5/5 | 5/5 |
| busiest-assignee | 4241 | 1752 | 2.4× | 1 | 6 | 5/5 | 4/5 |
| high-urgency-triggered | 3233 | 1717 | 1.9× | 1 | 5 | 5/5 | 2/5 |
| email-top-error (write) | 6206 | 2931 | 2.1× | 2 | 10 | 3/5 | 4/5 |
| **merged-prs-open-linear (JOIN)** | 7592 | 3049 | **2.5×** | **15** | **7** | 5/5 | 4/5 |
| compose-verify-issues (write) | 7336 | 5882 | 1.2× | 16 | 30 | 4/5 | 2/5 |

Robust medians across all 35 runs/arm: baseline **peak 5.7k, 1 tool call, 2 turns,
30/35 pass**; scratchpad **peak 1.9k, 6 tool calls, 6 turns, 26/35 pass**. The
scratchpad pass gap is entirely **6 weak-model spirals** (xiaomi/minimax, plus
deepseek on `compose`) that hit the 30-turn cap wandering the open SQL surface —
strong models (deepseek/kimi) don't.

Not a blowout — a **tradeoff**, and the axes separate cleanly:

- **Peak context** (largest single prompt = context-window occupancy) is the
  robust, near-universal scratchpad win: ~2–4× smaller across models and
  scenarios, because 32 tool schemas never enter context and only selected rows
  do. This is what drives compaction frequency and long-horizon headroom.
- **Tool calls / turns** cut both ways: scratchpad wins big on multi-item and
  cross-service work (one `JOIN` / `INSERT … SELECT` replaces an N-call loop) and
  loses on trivial single-tool questions (discovery tax).
- **Correctness** is model-dominated, not arm-dominated: strong models pass most
  cells in both arms; weak models fail in both. The scratchpad's failure mode is
  usually *over-exploration / turn exhaustion*, the baseline's is
  *under-counting* a long tool-result list it had to eyeball.

See `agentic-summary.md` for the per-model tables and aggregate reduction factors.

## Where scratchpad decisively wins: context pressure

The main matrix runs at a generous 100k limit on small result sets — the regime
where the baseline's directness is fine. The scratchpad's reason to exist is the
*other* regime: large result sets and/or a tight window. The scale demo
(`--out=compaction`, `scale=8` ⇒ ~320 PRs, `contextLimit=16000`,
[`compaction-summary.md`](compaction-summary.md)) isolates it — task: "how many
PRs are open?":

| model | baseline | scratchpad | peak ctx win |
|---|---|---|:--:|
| deepseek | ❌ FAIL — peak **16.4k** (window saturated, miscounted) | ✅ PASS — peak **1.9k** | **8.6×** |
| glm | ❌ FAIL — peak **16.0k** | ✅ PASS — peak **1.4k** | **11.4×** |
| kimi | ✅ PASS — peak **13.8k** | ✅ PASS — peak **1.2k** | **11×** |

The baseline pulls the entire PR list into context to "eyeball a count" — it
saturates the 16k window and **two of three models get the number wrong**. The
scratchpad answers with `SELECT COUNT(*) FROM github_pull_requests WHERE state =
'open'` — ~1.5k peak, correct every time. This is the crossover the essay
predicts: as the data outgrows the window, "fetch it all and read it" degrades in
both cost *and correctness*, while "push the computation to SQL" stays flat.

Note on compaction frequency: at the 100k limit these tasks rarely compact
(baseline 2, scratchpad 6 across 70 runs — scratchpad slightly *more*, because the
weak-model spirals accumulate context). Compaction is a lagging symptom; **peak
context is the leading indicator**, and it's where the two arms separate cleanly.
