# Is the Scratchpad a REPL? — exploring Lisp as the agent tool interface

*A design exploration building on ["The Scratchpad Is a Database"](PAPER.md)
and the SQL-as-tool-interface essay. Status: **live A/B run and hardened** —
three fluency batches took the arm from 62/77 to 72/77 (94%), see §10.*

---

## 1. Where this comes from

The SQL exploration ended in a strong place: resources as tables behind one
`execute_sql` tool took five budget models from 74% → 100%, beat the tool
baseline 93% vs 71% across the OSS frontier and the bargain bin, and cut peak
context 2–4× — *after* five rounds of hardening whose transferable lesson was
"behave exactly like the database the model already knows."

But the essay itself named two honest limits, and the hardening work quietly
confirmed both:

1. **Conditional branching doesn't reduce.** "IF nothing is broken post 'all
   clear' to Slack, ELSE email oncall the incident list" is a query, a look at
   the result, and a second query. The composition where the *action* depends
   on the *data* — arguably the most agent-shaped composition there is — is
   exactly the one SQL refuses to express in a statement.
2. **Volatile/effectful operations need execution-count guarantees.** The SQL
   engine's planner may lazily re-evaluate a FROM-relation once per
   correlated-subquery row, so the emulator grew a whole pre-resolution pass
   (parse → collect relations → resolve each exactly once → materialize → run)
   purely to stop an effectful tool from firing N times.

And a third observation from the last-mile autopsy (§7 of the paper): several
weak-model failures were **grammar-corner misparses** — `RETURNING` eaten as an
implicit alias, data-modifying CTEs unsupported, multi-statement scripts
discarding SELECT rows. SQL's surface is large enough that the emulator's
subset boundary is itself a failure source, and every fix means extending a
parser.

All three problems share a root: **SQL programs are strings in a big grammar,
evaluated by a planner the interface doesn't control.** The Lisp hypothesis is
that a small homoiconic language dissolves all three at once — and the risk is
that it gives up SQL's single greatest asset in exchange.

## 2. The hypothesis

> Expose the same resources as **functions in a tiny, sandboxed,
> Clojure-flavored Lisp** behind one `execute_lisp` tool. Keep every property
> the SQL work proved matters (single tool, in-band discovery, argument
> pushdown, off-context data flow, staged writes, read-your-writes, loud
> errors) and gain the three SQL can't offer: branching in one call,
> exactly-once effects by construction, and an inspection surface that costs
> nothing because the program *is* the syntax tree.

`glove-lisp` (packages/glove-lisp) is that surface. It consumes the **same
`ResourceTable` contract** as glove-scratchpad — the benchmark's ten servers
mount on it with zero new world code — so the A/B is pure surface-vs-surface.

## 3. Property-by-property mapping

Every design principle from the paper (§11), translated:

| Property | SQL surface | Lisp surface |
|---|---|---|
| One tool | `execute_sql` (+ `explain_sql`) | `execute_lisp` (+ `explain_lisp`) |
| Discovery in-band | `information_schema` + primed catalog | `(tables)` / `(describe :name)` + the same primed catalog |
| Argument pushdown | `WHERE col = v` equalities (Steampipe model) | `(resource {:col v})` map; vector values fan out like `IN`; required keys enforced with the fix named |
| Args are also filters | engine's residual WHERE | the session re-filters returned rows on every bound column |
| Off-context composition | `JOIN` / `INSERT … SELECT` inside the engine | `let` / `->>` pipelines inside the interpreter |
| Off-context *storage* | none (gate refuses `CREATE TABLE AS`) | **`def`** — named values persist in the session; `def` echoes `{:defined "prs" :count 320}`, never the rows |
| Bounded output | `LIMIT` + row cap | structural elision (25 items / 300 chars / depth 6, each marker naming the true size and the fix) |
| Exactly-once effects | volatility model + pre-resolution subsystem | **call-by-value evaluation** — a call fires when its form evaluates; the subsystem doesn't exist because the problem doesn't |
| Volatility caching | immutable / stable / volatile | identical declarations, same cache scopes |
| Write truth is cheap | command tags (`INSERT 0 15`), `RETURNING` | command tags (`insert! on "emails" fired — 15 row(s)`) on every write result |
| Read-your-writes | session overlay replayed over live reads | same overlay, ported verbatim |
| Staged outbound | `BEGIN … COMMIT/ROLLBACK` | `(stage …)` → `(commit!)` / `(rollback!)`; writing while staged is refused with the fix named |
| Inspectable before running | parse + statement-kind whitelist | the reader produces the tree; `explain_lisp` walks it (reads/writes/volatility/missing required keys/unknown names — through both branches of an `if`) |
| Loud errors naming the fix | v5 parity batches | did-you-mean on every unknown symbol/column/resource; type errors suggest the idiom (`(map :title …)` for keyword-on-list) |
| **Branching** | ✗ punt to the agent loop | **`if`/`cond` in one program** |

Where the SQL surface needed ~4,600 lines (a tokenizer, a recursive-descent
Postgres-subset parser, an evaluator, a materialization layer, and the
emulator's pre-resolution pass), the Lisp surface is ~1,900 — reader,
evaluator, stdlib, session — because homoiconicity and strict evaluation delete
two whole subsystems (the SQL grammar and pre-resolution). Fewer lines is not
the point; **fewer places to silently deviate from the model's muscle memory**
is, and the paper's most corrosive bug class ("the engine silently mis-answered
where Postgres would error") lived precisely in those subsystems.

## 4. What the model sees

System prompt: a ~1.3k-token preamble (language card + operating discipline +
the primed resource catalog with enum values — same catalog as the SQL arm) and
**2 tools** vs the baseline's ~32. The discipline block encodes the paper's
lessons directly: be decisive, one program that reads-computes-acts, def big
data, don't verify writes, errors name the one thing to change.

A representative turn (benchmark task `merged-prs-open-linear`):

```clojure
(let [done (->> (linear_issues) (filter #(= (:state %) "done")) (map :id))
      hits (->> (github_pull_requests {:state "merged"})
                (filter #(and (:closes_linear %) (not (contains? done (:closes_linear %))))))]
  (str (count hits) " PRs: "
       (join "; " (map #(str "PR " (:number %) " closes " (:closes_linear %)) hits))))
```

One call. The two row sets never enter context; the answer string does.

And the motivating case, impossible as one SQL statement:

```clojure
(if (empty? (pagerduty_incidents {:urgency "high" :status "triggered"}))
  (insert! :slack_messages {:channel "ops" :text "All clear."})
  (insert! :emails {:to_addr "oncall@acme.io"
                    :subject (str (count …) " high-urgency incidents live")
                    :body (join ", " (map :id …))}))
```

## 5. What has been validated (no API key required)

- **45 unit tests** (`pnpm --filter glove-lisp test`): reader, evaluator,
  stdlib, pushdown, fan-out, volatility (stable-within-call /
  immutable-across-calls / volatile-exactly-once), write gating, capability
  errors, staging lifecycle, read-your-writes, elision, fuel/depth budgets,
  error-UX regexes.
- **Nine deterministic probes** (`pnpm --filter glove-scratchpad-bench
  probe:lisp`): all seven benchmark scenarios hand-authored as the program a
  competent model should write, executed against the same seeded world + live
  in-process MCP servers, graded by the same verifiers — **all pass**, plus a
  decide-and-act branch probe (H) and a cross-call `def` persistence probe (I).

This is the expressiveness half of the argument: the surface can state every
task the benchmark asks, each as one program.

## 6. The open question: fluency is the whole bet

The paper's deepest finding was not about SQL per se — it was that **the
surface must behave like something the model already knows**, because weak
models run on muscle memory. SQL's muscle memory is universal: "a 3B local
model that fumbles a novel tool schema will still write a clean JOIN."

Lisp's is not universal, and this cuts both ways:

- *For*: Clojure is heavily represented in training data; the chosen subset is
  exactly its data-manipulation core (`->>`  pipelines, `group-by`,
  `frequencies`, keyword-as-function); models emit these idioms unprompted.
  The mercies (keyword≈string equality, `contains?` as membership, `str/…`
  aliases, `,` as whitespace) convert the most common instinct-mismatches from
  silent wrongness into silent rightness.
- *Against*: paren-balancing under decoding pressure, `%`-shorthand arity
  slips, and Clojure-isms outside the subset (`for` comprehensions, `loop/
  recur`, destructuring) are all plausible weak-model failure modes. Every one
  errs loudly with a suggestion — but the SQL work showed error-recovery costs
  turns, and turns are what weak models don't have.

The honest prior, given the paper's evidence: the Lisp arm should match or beat
the SQL arm on frontier and mid-tier models (branching tasks strictly favor it)
and the interesting cell is Qwen3-8B — does an 8B model's Clojure survive
contact with a real task loop?

## 7. Running the A/B

The benchmark now has a third arm; nothing else changed, so results are
directly comparable with the paper's tables:

```bash
# deterministic validation (no key):
pnpm --filter glove-lisp test
pnpm --filter glove-scratchpad-bench probe:lisp

# the A/B (OPENROUTER_API_KEY in repo-root .env):
pnpm --filter glove-scratchpad-bench bench --arms=baseline,scratchpad,lisp --budget=1.50 --out=lisp-ab
```

Suggested additions once the base matrix is in:

- **A branching scenario.** None of the seven tasks *requires* conditional
  composition (SQL had to be able to express them). Add one — e.g. the
  all-clear-vs-alert task from probe H — where the SQL arm structurally needs
  ≥2 calls and the Lisp arm needs 1, and grade the side effect.
- **The context-pressure demo** (§5 of the paper) on the Lisp arm: `(count
  (github_pull_requests {:state "open"}))` should hold the same ~1.5k peak as
  SQL's `SELECT COUNT(*)`.
- **A def-reuse scenario**: a two-part question ("how many open PRs? …now group
  those by repo") where the Lisp arm can `def` once and reuse, while both other
  arms re-fetch.

## 8. Caveats worth carrying into the analysis

- **Catalog descriptions are SQL-flavored.** Entity descriptions in the bench
  world say things like "INSERT opens a new issue" / "UPDATE (WHERE id=…) acks
  an incident". The Lisp arm inherits them verbatim (shared catalog — that's
  the point), and they may nudge a model toward SQL idioms mid-Lisp. If the
  live runs show confusion here, the fix is surface-neutral descriptions in the
  world spec, applied to both arms.
- **The stdlib's edges are untraveled.** The SQL engine earned its function
  library through five rounds of model-driven autopsy. The Lisp stdlib is a
  first guess at the same coverage; expect the live runs to reveal missing
  idioms (the equivalent of `string_agg` / `date_trunc` discoveries), and
  extend by the same rule — make the instinct correct, loudly reject the rest.
- **Fuel calibration is a guess.** 100k units with per-element charging passed
  every probe at scale=1; the 320-PR pressure world may need a higher default
  or a clearer "split the work with def" steer in the exhaustion message.
- **`update!`/`delete!` argument order** (`set` then `match`) is the one place
  the surface has no muscle-memory anchor at all. The usage string and
  `describe` both spell it out; watch the transcripts for swaps.

## 9. Where this could land

Three outcomes, all useful:

1. **Lisp ≥ SQL across the roster** → the REPL becomes the primary scratchpad
   surface; SQL remains an alternative dialect over the same `ResourceTable`
   catalog for analytics-heavy worlds.
2. **Lisp wins on strong models, loses in the weak tail** → the surfaces
   coexist behind a capability switch (they already share the catalog), or the
   Lisp surface shrinks further (fewer forms, more mercies) until the tail
   holds.
3. **Lisp loses broadly** → the fluency thesis is confirmed the hard way, and
   the SQL surface inherits the one thing worth stealing regardless: a
   `CASE`-shaped or two-phase decide-and-act affordance to close the branching
   gap.

The mechanism that decides between them is the same instrumentation the paper
used: run the weak tier, read every failing transcript, and ask "platform gap
or capacity floor?" — the Lisp surface was built so that every gap found has an
obvious place to fix.
## 10. Results: the live A/B (11 models × 7 tasks)

§6's bet — "fluency is the whole bet" — was tested and resolved the same way
the SQL arm was: run, read every failing transcript, fix the platform, repeat.
Three fluency batches in three rounds (all models from the paper's roster;
`results/lisp-ab{,2,3}-*`):

| round | build | pass | notes |
|---|---|:--:|---|
| 1 | as merged | 62/77 (81%) | frontier fine (20/21); weak tail struggles |
| 2 | + batch 1 | 64/77 (83%) | 5 of the 13 misses were provider 429s |
| 3 | + batches 2–2b | 72/77 (94%) | 2 of 5 misses provider errors |
| 4 | + batch 3 (residual models re-run) | 73/77 (95%) | 2 misses are provider 429s |
| 5 | + batch 4 (destructuring, `second`, fired-write note) | **74/77 (96%)** | 2 misses are provider 429s → **74/75 (99%) graded — parity with SQL** |

Final per-model (three arms, same servers/tasks/graders — baseline & SQL from
the paper's runs):

| model | tier | baseline | SQL scratchpad | Lisp |
|---|---|:--:|:--:|:--:|
| Kimi K2.7 Code | frontier | 5/7 | 7/7 | **7/7** |
| GLM-5 | frontier | 4/7 | 7/7 | **7/7** |
| MiniMax M3 | frontier | 7/7 | 7/7 | **7/7** |
| DeepSeek V3.2 | frontier | 6/7 | 7/7 | **7/7** |
| Kimi K2.5 | mid | 6/7 | 7/7 | **7/7** |
| MiniMax M2.5 | mid | 6/7 | 7/7 | **7/7** |
| Xiaomi MiMo v2.5 | mid | 6/7 | 7/7 | **7/7** |
| GLM 4.7 Flash | mid | 5/7 | 7/7 | **7/7** |
| DeepSeek V4 Flash | weak | 7/7 | 7/7 | **7/7** |
| Qwen3 30B A3B | weak | 3/7 | 7/7 | **7/7** |
| Qwen3 8B | weak | 4/7 | 6/7 | 4/7¹² |
| **total** | | 59/77 (77%) | 76/77 (99%) | **74/77 (96%)** |

¹ two cells lost to provider 429s, not graded failures. ² qwen8b's one real
miss (email body must contain the issue's *title*; it wrote the id) is the SAME
comprehension slip it makes on the SQL arm — a shared capacity floor, not a
surface difference. **Graded, the two arms are at parity: 74/75 vs 76/77 — every Lisp
cell that can pass does, and the one residual failure mode is shared.**

Peak context matches the SQL arm (~1.9–3.2k median per model vs the baseline's
4.5–6.5k) — the off-context property holds identically.

### What the transcripts taught (the fluency batches)

Every failure cluster was a **platform gap**, and every fix followed the
paper's rule — make the instinct correct, loudly reject the rest:

- **Batch 1 — the comparator that silently lied.** `(sort-by :count > coll)`
  ignored the comparator (only a `:desc` keyword worked): ascending order made
  `first` pick the *minimum* — one silent wrong answer failed the email task on
  five models at once. Plus: variadic `max-key`/`min-key` (`(apply max-key
  :count rows)` — its arity error was a 20-turn thrash on three models), rows
  now **omit nil columns** so `(contains? % :closes_linear)` means "has a
  value" (the compose cluster opened 27 issues instead of 15), `get`/`get-in`
  on a list of maps redirect loudly, `if-let`/`when-let`/`key`/`val`/`juxt`,
  empty-`stage`/`rollback!` made loud, zod dumps reduced to one line.
- **Batch 2 — effect iteration.** Models spell "insert per row" as
  `doall`+`map`, `doseq`, `run!`, `map-indexed` — all missing; deepseek
  hand-unrolled 15 inserts (one typo = fail) and glm died trying. All added;
  the preamble now names the best form: `(insert! :table (map fn rows))` —
  one call, full count. Read-your-writes overlay gained content-dedup (a
  re-read after commit double-counted reflected writes: 30 where 15 were
  written). `.startsWith`-style interop and tool-name symbols get targeted
  redirects.
- **Batch 3 — count the write, peek the def.** A model bulk-inserted all 15
  rows perfectly then reported "5" — `(count (insert! …))` counted the result
  *map's keys*; `count` on a write result now returns its `:count`. And two
  cells computed the right count then **fabricated ids** they never read —
  `def`'s echo now carries a small elided peek of real values.

### The structural scenarios (branching, reuse, pressure)

Two scenarios were added to test what the REPL is *for* (`incident-branch`:
read PagerDuty, then post all-clear to Slack OR email the incident list -
graded on the outbox taking the *correct* branch; `open-prs-breakdown`: a
two-part total + per-repo-leader question), run across all three arms:

| scenario | baseline | SQL scratchpad | Lisp |
|---|:--:|:--:|:--:|
| incident-branch (decide-and-act) | 9/10 | 9/10 | **10/10** |
| open-prs-breakdown (two-part) | 7/11 | **11/11** | 9/10 |

On the branching task the Lisp arm is the only 10/10 - **qwen30b passes only
on Lisp** (it failed the read-look-write choreography on both other arms, but
`(if (empty? live) (insert! :slack ...) (insert! :emails ...))` is one shape),
and glm5 / minimax3 / qwen30b / xiaomi each did decide-and-act or the two-part
answer in **a single tool call** - the structural signature SQL cannot produce
(its best is two calls: read, then write). The baseline's breakdown failures
are the familiar mode: 4.7-10.8k-token eyeballed lists, miscounted. The one
Lisp miss is qwen30b inventing a column (`:base_ref`) and hallucinating a repo
name while the def peek was showing it the real keys - truth in front of it,
unread: a capacity floor, not a gap.

The context-pressure demo (par. 5 of the paper: ~320 PRs, 16k window) also
holds on the Lisp arm: deepseek / glm / kimi all pass at **1.9-2.3k peak**
with `(count (github_pull_requests {:state "open"}))` - the same flat profile
as SQL, where the tool baseline saturated the window and two of three models
miscounted.

Batch 4 (from these transcripts): binding **destructuring** in
fn/let/doseq/if-let (`(fn [[repo cnt]] ...)` over `group-by` is
bread-and-butter Clojure; its absence cost qwen30b 19 turns),
`second`/`mapv`/`filterv`, and the **fired-write note** - a write that fires
and is followed by an error in the same program now names itself in the error
("N write(s) had ALREADY FIRED - fix and re-run WITHOUT repeating them"),
closing the double-send footgun that cost xiaomi the branching cell.

### Verdict against par. 9

Outcome 1 with the receipts: the hardened Lisp arm beats the tool baseline decisively (96% vs 77%) and reaches graded parity with the SQL arm (74/75 vs 76/77) - every remaining difference is provider luck or a comprehension floor shared by both arms. On the structural scenarios it goes further: the only arm to carry a weak model through decide-and-act, in one call. Par. 6's 'fluency is the whole bet' resolved emphatically: the gap to SQL collapsed from 14 cells to zero graded difference across five fluency batches, every one of which was 'make the idiom models actually write correct'. The
surfaces share the catalog; the honest recommendation is unchanged from §9's
second landing: **SQL as the default for the weakest tail, the REPL wherever
branching, staged multi-writes, or session state matter — and they coexist
behind one `ResourceTable` registration.**

## 11. The choice study and the complex suite

Two follow-on questions, both run live (results in `results/bothstudy-*` and
`results/complex-*`, analysis via `src/both-analysis.ts`):

**What does a model pick when BOTH surfaces are mounted?** A fourth arm mounts
`execute_sql` and `execute_lisp` together over one catalog behind a neutral
two-surface preamble. Across 11 models x 9 scenarios (99 cells, 91 pass, 2
provider errors):

- **Revealed preference is SQL: 83 cells sql-only, 8 lisp-only, 6 mixed.**
  Muscle memory dominates when either surface would do.
- **The exception is exactly the branch-shaped task**: on `incident-branch`,
  5 of 11 models switched to Lisp unprompted — models sense when if-composition
  fits. On everything argmax/aggregate/join-shaped, SQL swept.
- **No choice penalty**: pass-when-sql 79/83, pass-when-lisp 7/8, mixed 5/6 —
  mounting both surfaces does not confuse even the weak tier, and the arm's
  totals match the single-surface arms cell-for-cell.

**What happens when the tasks get genuinely hard?** Three complex scenarios —
a negation join (`reconcile-ghost-issues`: 'done' issues claimed only by
never-merged PRs), a multi-metric grouped report, and a conditional
ack-fan-out escalation — across all four arms (33 cells/arm):

| arm | pass | median peak ctx |
|---|:--:|:--:|
| baseline | 22/33 | 9,731 |
| SQL scratchpad | 22/33 | 2,362 |
| **Lisp** | **24/33** | 3,735 |
| both | 22/33 | 2,628 |

Three findings. (1) **Complexity is the next frontier**: every arm drops from
92–99% on the simple suite to 67–73% here — the remaining failures are
composition quality, not surface mechanics. (2) **The Lisp arm leads on the
negation join (9/11) while the SQL arm is WORST there (6/11)**: models write
subtly wrong `NOT EXISTS`/`NOT IN` SQL but reach the same logic naturally as
`(filter #(not (some merged? …)))` — the one task family where the REPL beats
SQL on *reads*. (3) **"Both" buys robustness, not synergy**: it matches the
better single surface per task shape but never exceeds it, at SQL-like peak
context. Preparing this suite also caught three latent platform bugs before
any model did (cross-scope binding leak, cross-alias fetch starvation,
multi-value arg narrowing) — deterministic probing of harder tasks is itself
a bug-finder.

## 12. Reproducing

```bash
pnpm --filter glove-lisp test          # 63 unit tests
pnpm --filter glove-scratchpad-bench probe:lisp   # 9 deterministic probes
pnpm bench --arms=baseline,scratchpad,lisp        # the full A/B (needs OPENROUTER_API_KEY)
npx tsx src/lisp-compare.ts lisp-ab3-results.json # the three-arm table
```

