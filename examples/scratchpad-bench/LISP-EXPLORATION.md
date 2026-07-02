# Is the Scratchpad a REPL? — exploring Lisp as the agent tool interface

*A design exploration building on ["The Scratchpad Is a Database"](PAPER.md)
and the SQL-as-tool-interface essay. Status: surface built and deterministically
validated; model-in-the-loop A/B wired but not yet run.*

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

Every design principle from the paper (§9), translated:

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
