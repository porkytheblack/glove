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

- **Read-after-write on virtual tables** *(now solved — see "Read-your-writes"
  below).* Scratchpad tables are *live views*: a sent `emails` row (fired to the
  outbox) originally did **not** appear in a later `SELECT … FROM emails` (which
  re-runs the inbox list). Models that tried to *verify* a write by re-querying
  spiralled — deepseek burned 25 tool calls / 26 turns on `email-top-error`
  chasing a row that would never show up. This is now fixed at the source with a
  read-your-writes overlay, so a re-query returns the write.
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

## Optimizing the scratchpad for weak models (v1 → v3)

The v1 matrix showed the scratchpad's failure mode was **weak models spiralling**
in the open SQL surface (6/35 runs hit the 30-turn cap). Three rounds of
hardening — all in `glove-scratchpad`, all measured on the same 5-model × 7-scenario
scratchpad arm:

| version | change | pass | spirals | median tool calls | avg turns | avg peak |
|---|---|:--:|:--:|:--:|:--:|:--:|
| **v1** | (baseline) | 26/35 (74%) | 6 | 6 | 11.0 | 2961 |
| **v2** | engine teardown fix + preamble discipline + drop distractor tables | 25/35 | **0** | 3 | 4.1 | 2150 |
| **v3** | + surface enum values in the primed catalog | **34/35 (97%)** | 0 | **2** | **3.5** | 2178 |

What each round did:

- **v2 — kill the spirals.** (1) The ephemeral-table teardown bug (above) was the
  detonator: a valid query would die with "already exists" and the model would
  panic-thrash. (2) The preamble gained anti-spiral discipline — don't re-read to
  verify a write (killed a 25-call read-after-write loop), a single write fires
  directly (BEGIN only to stage several), be decisive / stop when you have the
  answer. (3) The primed table catalog removed the discovery round-trip. (4)
  Dropping the duplicate required-key singleton tables removed the "requires
  equality on id" confusion. Result: **spirals 6 → 0, avg turns 11 → 4**, and the
  six spiral-fails became passes. But pass rate stayed flat — because a model that
  no longer thrashes *commits to its first interpretation*, exposing enum errors
  the thrashing used to stumble past (`urgency = 'HIGH'` vs `'high'`; "unresolved"
  read as `!= 'resolved'`, catching an `ignored` issue).

- **v3 — feed the models the valid values.** Those enum values already lived in
  the column descriptions (`status: unresolved | resolved | ignored`), but the
  model couldn't see them — `information_schema.columns` returns only name+type.
  Surfacing described columns in the primed catalog (~+300 tokens) let weak models
  pick the right filter values: **25 → 34 pass**, recovering nine cells, efficiency
  held. Every model now passes ≥6/7.

Net v1 → v3: **74% → 97% pass, spirals 6 → 0, tool calls 6 → 2 (median), turns
11 → 3.5, peak 2961 → 2178** — i.e. the scratchpad went from "wins on context but
weak models spiral" to "wins on context AND weak models breeze through it," which
was the goal. The single residual (glm on the multi-write compose) is a
transaction-lifecycle slip: it ran `BEGIN; INSERT … SELECT` and stopped without
`COMMIT`, so the staged write silently never fired.

## Read-your-writes: closing the read-after-write gap (v4)

The preamble told models *not* to re-read their writes — but agents ("droids")
re-read reflexively, and you can't prompt an instinct away. The v1 read-after-write
spirals came from a re-query returning **nothing** (the upstream is a live view
that hasn't caught up), which reads to the model as "my write failed."

The fix makes read-your-writes **true** rather than forbidden. `glove-scratchpad`
now keeps a per-session write overlay: every fired INSERT/UPDATE/DELETE is recorded
and, at read time, replayed over the resource's freshly-fetched live rows (in write
order — inserts append, updates patch, deletes drop) before the engine runs the
query. The upstream service stays a live view; the *session* becomes read-your-writes,
which is the model an agent already has ("I created it, so I can see it"). It's a
`DatabasePolicy` flag (`readYourWrites`, default on) and dedups inserts by required
key so an upstream that *does* reflect the write won't double it. Proven
deterministically by `probe.ts [D]` (INSERT an email → SELECT finds it, inbox
50 → 51) and 7 unit tests (insert/update/delete visible, ROLLBACK discards,
required-key replace, flag-off = old semantics); glove-scratchpad **47/47**.

Measured effect (scratchpad arm, v3 → v4): **pass-neutral, 34/35, 0 spirals** — the
overlay is a robustness net *under* the preamble, not a pass-rate lever, since the
graders score the real outbox and by v3 the preamble already suppressed the spirals.
Its value is that a model which re-reads anyway now succeeds instead of spiralling,
and the false "your write won't appear" line is gone from the preamble.

One honest wrinkle it surfaced: on `compose` the single failing cell moved
(glm ✗→✓, minimax ✓→✗; compose stayed 4/5 both runs). The minimax trace is
instructive — it wrote several malformed `INSERT … SELECT`s, and read-your-writes
let it *see* the resulting bad rows on re-query; it then tried `DELETE FROM
github_issues` to clean up and hit "not deletable" (the `create_issue` capability
has no delete). So the overlay gave the model visibility into its own mistake, but
**irreversible capabilities (no DELETE) mean a wrong write can't be self-healed** —
inherent to the capability surface, not the overlay. Worth a preamble note ("get
`INSERT … SELECT` right the first time; preview the SELECT before you write") more
than a code change.

## Database-parity pass: making it feel like a real DB (v5)

A multi-agent audit ([`PARITY-AUDIT.md`](PARITY-AUDIT.md), 4 mappers → 6 parity-lens
finders → per-gap adversarial verify → synthesis, 47 agents) asked a sharper
question than pass rate: *does the scratchpad behave like a database a droid already
knows how to drive?* It found **30 confirmed gaps** sharing one corrosive root —
the engine **silently mis-answered where Postgres errors** (a typo'd column, `+`
on text, `= 'HIGH'`, `= 'false'`, a bare `current_date`, a forgotten `COMMIT` all
returned a confident wrong answer), contradicting glove-sql's own "throw rather
than mis-answer" tenet. Headline claims were re-verified by hand against the engine.

Five batches closed it (all with regression tests — glove-sql 102/102,
glove-scratchpad 53/53):

- **A — loud errors + idiom resolution**: boolean `= 'false'` was *inverted*
  (`Boolean('false')` is truthy) — fixed; `+`-on-text throws with a `||` hint;
  **unknown column throws** instead of returning NULL; column/table refs resolve
  case-insensitively; `current_date`/`current_timestamp`, leading `public.`,
  actionable parse errors, `table_type='BASE TABLE'`.
- **C — function library**: `string_agg`/`array_agg`/`json_agg`/`bool_or`/`bool_and`,
  `date_trunc`/`date_part`/`EXTRACT(field FROM ts)`.
- **D — introspection**: `information_schema.columns` exposes `is_nullable`
  (required keys) and `description` (enum values) — keys and valid values are now
  discoverable via SQL, not just the primed hint.
- **B — RETURNING**: `INSERT/UPDATE/DELETE … RETURNING` on native tables; virtual
  `INSERT … RETURNING` in the scratchpad.
- **E — write safety**: transaction **auto-rollback on error** (kills the
  stranded-`BEGIN` footgun); capability errors list supported ops; **over-broad
  UPDATE/DELETE** (range/OR WHERE) is rejected rather than silently widened.

Measured effect on the weak-model scratchpad arm (v4 → v5): **34/35 → 35/35 (100%)**,
0 spirals, median 2 tool calls, avg 3.7 turns — the parity work fixed the last
residual (glm/compose, via auto-rollback) **without** the new loud errors
destabilizing any weak model. Full arc across every round: **v1 74% → v3 97% →
v5 100%.**

## Expanded roster: OSS frontier + cheapest models (A/B)

To test how far the hardening + parity work generalizes, the full scenario suite
was run on a wider roster — current OSS frontier (kimi-k2.7-code, glm-5,
minimax-m3, deepseek-v3.2) and the cheapest tool-capable models (deepseek-v4-flash,
qwen3-30b, qwen3-8b) — on **both arms** (84 runs, ~$0.27,
[`roster-results.json`](roster-results.json), `src/roster.ts`):

| model | tier | pass base→scr | peak base→scr |
|---|---|:--:|:--:|
| Kimi K2.7 Code | frontier | 5/7 → **7/7** | 4466 → 1750 |
| GLM-5 | frontier | 4/7 → **7/7** | 6318 → 2008 |
| MiniMax M3 | frontier | 7/7 → **7/7** | 6423 → 2179 |
| DeepSeek V3.2 | frontier | — | — |
| DeepSeek V4 Flash | weak | 7/7 → **7/7** | 6490 → 2249 |
| Qwen3 30B A3B | weak | 3/7 → **6/7** | 4569 → 1898 |
| Qwen3 8B | weak | 4/7 → **5/7** | 4560 → 1828 |

Aggregate: **scratchpad 39/42 (93%) vs baseline 30/42 (71%)**; frontier **21/21 (100%)
vs 16/21**; weak **18/21 vs 14/21**; peak context **2.5–2.7× smaller** everywhere.

Three things stand out:

1. **Even frontier models fail the baseline** — GLM-5 4/7, kimi-k2.7 5/7 — for the
   same reason weak models did: pulling a large tool-result list into context to
   "eyeball" a count/JOIN saturates the window and miscounts. The scratchpad's
   `COUNT`/`JOIN` fixes it, taking every frontier model to 7/7. The context win is
   capability-independent.
2. **A $0.09/M model (deepseek-v4-flash) scores 7/7 with the scratchpad** — the
   parity work genuinely lets a cheap model punch at frontier level on these tasks.
3. **The floor is real but cheap.** qwen3-8b/30b still miss 1–2 of the hardest
   cells, but they miss *fast* (3–4 turns, no spirals) — decisive wrong answers
   from genuine 8B/30B capacity limits, not the context/thrash failures the
   hardening removed. The scratchpad can't make an 8B model smart; it can stop it
   from drowning.

## Last-mile pass: the "capacity floor" was mostly platform (v6)

The roster run left 3 weak-model failures that looked like genuine 8B/30B capacity
limits. Autopsying the transcripts showed **all three were platform gaps**:

1. **qwen30b / compose** — its 15-row `INSERT … SELECT` *succeeded*, but the result
   carried no row count (`rows: []`), so the model reported *"I opened 0 new GitHub
   issues."* Postgres answers `INSERT 0 15`; we answered nothing.
2. **qwen8b / sentry** — it ran two SELECTs in one call; our error message told it
   to use `BEGIN … COMMIT`; it complied — and the COMMIT result **discarded the
   SELECT rows**, so it saw nothing and reported *"there are no unresolved issues."*
   Our own affordance taught the failure.
3. **qwen8b / email** — its first two attempts were *canonical Postgres* (`WITH …
   INSERT`, `INSERT … SELECT … RETURNING *`) and both failed to parse (data-modifying
   CTEs unsupported; `RETURNING` eaten as an implicit alias), so it degraded its
   query until the body was wrong.

Fixes (all product-side, with regression tests): write results carry the **command
tag** (`rowCount` + `insert on "x" fired — 15 row(s)`; staged/COMMIT list per-write
counts); scripts **return the last SELECT's rows** and the multi-statement error
steers to one-per-call; `WITH … INSERT/UPDATE/DELETE` parse and resolve;
`returning` is reserved; virtual `INSERT…SELECT…RETURNING` works; a **0-row read
carries a re-check nudge** (with the exact `information_schema` query to run); and
`sentry_issues.project` documents its valid values. glove-sql 111/111,
glove-scratchpad 60/60.

Re-run (same weak tier, scratchpad arm): **qwen30b 6/7 → 7/7, qwen8b 5/7 → 6/7,
dsflash 7/7 → 7/7** — weakest-tier total **18/21 → 20/21 (95%)**, all passes ≤4
turns, no spirals. The one residual is now a *demonstrated* capacity floor: the
prompt asks for the issue's **title** in the email body; qwen8b wrote
`'Top error: ' || project`, and `RETURNING` even showed it exactly what it sent —
a comprehension miss on an explicit instruction, with the platform path perfect
(single statement, write fired, result observable). That is what an honest floor
looks like: the model fails on *meaning*, not on mechanics.

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
