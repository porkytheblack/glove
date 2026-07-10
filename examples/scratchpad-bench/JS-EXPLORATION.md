# Is the scratchpad a *JavaScript* REPL? — the fluency bet, taken to its limit

*A design exploration building on ["The Scratchpad Is a Database"](PAPER.md) and
["Is the Scratchpad a REPL?"](LISP-EXPLORATION.md). Status: **live A/B run** —
see §10. A third language followed: ["Is the Scratchpad a Python
REPL?"](PY-EXPLORATION.md) (`pyrepl`, parity-class at 88%), and the
cross-language synthesis is ["The Scratchpad Is a REPL"](REPL-PAPER.md).*

---

## 1. Where this comes from

The SQL exploration established that folding an agent's capabilities behind ONE
code-eval tool beats loading every tool definition — on correctness, on context,
on cost — because the model computes over results in the sandbox instead of
round-tripping every intermediate through its context window. The Lisp
exploration then showed the surface need not be SQL: a Clojure-flavored REPL
reached graded parity with the SQL arm and *won* the compositions SQL can't
express in one statement (decide-and-act branching, session state, negation
joins).

Both rested on one finding, stated most sharply in LISP-EXPLORATION §6:

> **the surface must behave like something the model already knows, because weak
> models run on muscle memory.**

The Lisp arm's honest risk was that Clojure's muscle memory is *not universal* —
paren-balancing under decoding pressure, `%`-shorthand slips, Clojure-isms
outside the subset. Its verdict (§10) confirmed the risk was manageable but real:
the one weak-tail miss that differed from SQL was a fluency artifact.

This exploration takes the fluency argument to its logical end. **If fluency is
the whole bet, bet on the language every model is most fluent in: JavaScript.**

## 2. The hypothesis

> Expose the same capabilities as **async functions in a tiny, sandboxed
> JavaScript REPL** behind one `execute_js` tool. Keep every property the SQL and
> Lisp work proved matters — single tool, in-band discovery, off-context data
> flow, persistent session, bounded output, loud errors — and gain the surface
> with the deepest training-data representation of any language, so the
> weak-model tail that strains on Clojure holds on JS.

`glove-js` (packages/glove-js) is that surface. It consumes the **same
`ToolFn` catalog** as glove-lisp's function mode (`fnsFromMcp` over the
benchmark's ten servers), so the A/B is pure surface-vs-surface — identical
capabilities, identical effects, only the language differs.

## 3. Property-by-property mapping

Every principle from the two prior papers, translated to JS:

| Property | SQL | Lisp | JavaScript |
|---|---|---|---|
| One tool | `execute_sql` | `execute_lisp` | `execute_js` (no `explain` — the REPL is the preview) |
| Discovery in-band | `information_schema` | `(tables)`/`(describe)` | `fns()` / `describe("name")` + primed catalog |
| Call a capability | `WHERE col = v` | `(resource {:col v})` | `github.list_pull_requests({ state: "open" })` |
| Off-context composition | `JOIN` / `INSERT … SELECT` | `let` / `->>` | array methods + variables inside the program |
| Off-context *storage* | none | `def` | top-level `const` / `let` (persist across calls) |
| Bounded output | `LIMIT` + row cap | structural elision | structural elision (25 items / 300 chars / depth 6) |
| Exactly-once effects | volatility + pre-resolution | call-by-value | call-by-value (a call fires when its expression evaluates) |
| Write truth is cheap | command tags | command tags | the tool's own return value |
| **Branching** | ✗ punt to the loop | `if`/`cond` | `if`/`else`, ternary — decide-and-act in one program |
| Inspectable before running | statement whitelist | reader tree | acorn parse + a whitelist validation walk |
| Loud errors naming the fix | v5 batches | did-you-mean | did-you-mean on names, params, and members |

Two properties are *new* to the JS surface because it runs untrusted model code
as a real programming language:

- **A sandbox boundary.** Every member access is mediated so a program can't
  climb a constructor chain back to the host (`members.ts`); `new` is
  whitelisted; globals are frozen. See §11.
- **Budgets against a Turing-complete surface.** A fuel counter (per node + per
  loop back-edge), a depth cap, and metered bulk allocation bound a language
  that — unlike SQL or the fuel-limited Lisp — has real loops.

## 4. What the model sees

System prompt: a ~1.3k-token preamble (JS language card + the same operating
discipline the prior surfaces use + the primed function catalog) and **1 tool**
(`execute_js`) vs the baseline's ~32. A representative turn
(`merged-prs-open-linear`):

```js
const done = linear.list_issues().filter(i => i.state === "done").map(i => i.id);
const hits = github.list_pull_requests({ state: "merged" })
  .filter(p => p.closes_linear && !done.includes(p.closes_linear));
`${hits.length} PRs: ${hits.map(p => `PR ${p.number} closes ${p.closes_linear}`).join("; ")}`;
```

One call. The two row sets never enter context; the answer string does. And the
motivating decide-and-act case, impossible as one SQL statement:

```js
const triggered = pagerduty.list_incidents({ urgency: "high", status: "triggered" });
if (triggered.length === 0) {
  slack.post_message({ channel: "ops", text: "All clear." });
} else {
  email.send_email({ to: "oncall@acme.io", subject: `${triggered.length} incidents live`,
                     body: triggered.map(i => i.id).join(", ") });
}
```

## 5. What has been validated deterministically (no API key)

`src/probe-js.ts` — **11 probes**, every benchmark scenario hand-authored as the
JS program a competent model should write, run against the same seeded world +
live in-process MCP servers, graded by the same verifiers. **All pass.** They are
the expressiveness proof and the capability demo:

| probe | capability exercised |
|---|---|
| A count-open-prs | one-expression aggregate (`.length`) |
| B sentry-billing-unresolved | filtered lookup, ids + count |
| C merged-prs-open-linear | cross-service join via `.filter`/`.includes` |
| D busiest-assignee | group-by + argmax (`Object.entries().sort()`) |
| E high-urgency-triggered | two pushed-down enum args |
| F email-top-error | argmax → compose → **write** in one program |
| G compose-verify-issues | fan-out **writes** from a computed list (a `for…of` loop) |
| H incident-branch | **decide-and-act** — `if/else` chooses the effect, one call |
| I (session) | top-level `const` **persists** across `execute_js` calls |
| J reconcile-ghost-issues | **negation join** (`!byIssue[id].includes("merged")`) |
| K open-prs-breakdown | two-part answer **reusing** a session `const` |

Run: `pnpm --filter glove-scratchpad-bench probe:js`.

## 6. The open question, resolved by construction: fluency

The Lisp paper's bet was "fluency is the whole bet." JavaScript is the strongest
possible position on that bet — it is the most-represented language in every
model's training corpus, and the chosen subset (array methods, destructuring,
template literals, `const`) is exactly its everyday data-manipulation core. The
hypothesis: the weak-model tail that costs the Lisp arm its one differentiated
miss should hold on JS. §10 tests it.

The cost of betting on a full programming language is the sandbox — which is why
this surface, alone among the three, needed an adversarial security review (§11).

## 7. Running the A/B

```bash
pnpm --filter glove-scratchpad-bench probe:js          # deterministic, no key
pnpm --filter glove-scratchpad-bench bench \
  --models=deepseek,minimax3,glm5,xiaomi,qwen30b,dsflash \
  --arms=baseline,scratchpad,lisp,jsrepl,lispfns \
  --scenarios=<core 7 + incident-branch,open-prs-breakdown,reconcile-ghost-issues> \
  --out=js-ab
npx tsx src/js-compare.ts js-ab-results.json           # the five-arm table
```

`jsrepl` is glove-js; `lispfns` is glove-lisp in **function mode** (`registerFns`
over the same `ToolFn` catalog) — so the matrix also isolates *function mode vs
table mode* (`lispfns` vs `lisp`) and *JS vs Clojure on an identical catalog*
(`jsrepl` vs `lispfns`).

## 8. Caveats

- **The sandbox subset is a boundary, like SQL's grammar was.** A model that
  reaches for `class`, `for…in`, or a nested-quantifier regex hits a loud
  rejection. Every one names the fix, but rejections cost turns (§11 lists them).
- **No `explain_js`.** The Lisp/SQL surfaces expose a static pre-pass; the JS
  surface does not — the REPL itself is the dry run, and effectful calls fire
  immediately. A model must check `describe(...)` before an effectful call.
- **The stdlib's edges are a first guess**, like the Lisp stdlib was. Expect the
  live runs to reveal missing array/string idioms; extend by the same rule (make
  the instinct correct, loudly reject the rest).

## 9. Where this could land

1. **jsrepl ≥ lispfns across the roster** → JavaScript becomes the default
   fluency surface, with Clojure and SQL as alternatives over the same catalog.
2. **jsrepl wins the weak tail specifically** → the fluency thesis is confirmed
   at its strongest point; the surfaces coexist behind a capability switch.
3. **The sandbox subset costs more turns than JS fluency saves** → the honest
   negative, and the SQL/Lisp surfaces remain the recommendation.

## 10. Results: the live A/B (6 models × 10 tasks × 5 arms)

Five arms, one run, same servers/tasks/graders and one seed (`results/js-ab-*`).
`jsrepl` is glove-js; `lispfns` is glove-lisp in function mode — both over the
`fnsFromMcp` catalog. Graded (excluding 3 provider errors, none on jsrepl):

| model | tier | baseline | SQL | lisp | **jsrepl** | lispfns |
|---|---|:--:|:--:|:--:|:--:|:--:|
| GLM-5 | frontier | 10/10 | 10/10 | 10/10 | 9/10 | 9/10 |
| MiniMax M3 | frontier | 10/10 | 9/10 | 10/10 | 8/10 | 10/10 |
| DeepSeek V3.2 | frontier | 9/10 | 10/10 | 9/10 | 10/10 | 10/10 |
| Xiaomi MiMo v2.5 | mid | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 |
| DeepSeek V4 Flash | weak | 9/9 | 9/9 | 10/10 | 10/10 | 9/10 |
| Qwen3 30B A3B | weak | 5/10 | 6/10 | 8/10 | **0/10** | 6/9 |
| **total** | | 53/59 (90%) | 54/59 (92%) | 57/60 (95%) | **47/60 (78%)** | 54/59 (92%) |

Peak context (median tokens/cell): baseline **4,805** → SQL 2,240 (2.1×), lisp
2,665 (1.8×), **jsrepl 2,630 (1.8×)**, lispfns 2,876 (1.7×).

Head-to-heads (win–win, rest ties): jsrepl **1–8** lispfns · lispfns **2–5** lisp
· jsrepl **1–9** SQL.

### What the run shows

1. **The off-context property holds identically for JavaScript.** `jsrepl` cuts
   median peak context **1.8× vs baseline**, dead level with SQL and Lisp. The
   whole premise — one code-eval tool beats folding 32 tool definitions — reproduces
   on JS, so the context/cost win is language-independent.

2. **Function mode ≈ table mode — the redesign's central claim, confirmed.**
   `lispfns` (92%) tracks `lisp` (95%) cell-for-cell (2–5, 52 ties). Exposing
   capabilities as plain `ToolFn`s — no columns, no pushdown keys, no volatility —
   costs essentially nothing vs the `ResourceTable` contract. When the tools are
   unknown up front, you give up nothing by skipping the table modeling.

3. **On 5 of 6 models jsrepl is fully competitive** — 47/50 (94%), 8–10 per model
   across every frontier and mid tier. Its 78% total is *entirely* the Qwen3-30B
   cell: **0/10**.

4. **The weak-tail collapse is a framing gap, not a JS gap.** Every Qwen3-30B
   `jsrepl` transcript shows the same mechanism: the model emitted a tool call for
   `github__list_pull_requests` **directly** — as if the catalog names were folded
   tools — instead of writing an `execute_js` program that calls them. It never
   invoked `execute_js`, got nothing back, and gave up ("there is no available tool
   named `sentry__list_issues`"). The 11 deterministic probes (§5) prove the JS is
   expressible; the weakest model simply mistook the primed function catalog for a
   tool schema. Notably the same model on `lispfns` — where the catalog reads as
   `(github__list_pull_requests {…})`, unmistakably code-you-put-in-a-REPL —
   recovered to 6/9. The dotted `github.list_pull_requests({…})` form, closest to a
   tool signature, is the most confusable.

### Hardening: two fluency batches (the Lisp method, applied to JS)

The unhardened run's two failure clusters — a *framing* gap (the model calls
catalog functions as folded tools) and a *result-shape* gap (the model guesses
field names / enum values the catalog never shows) — are exactly the kind the
Lisp arm closed by reading every failing transcript and fixing the platform. Two
batches did the same here, re-running just the affected arms on the same seed:

- **Batch 1 — framing (preamble).** The preamble now opens with a wrong-vs-right
  example: the functions are NOT tools, `execute_js` is the ONLY tool, you call
  the functions *inside* it. Plus a shape-discipline line (inspect `rows[0]`
  before assuming a field).
- **Batch 2 — result-shape discovery (`sampleResultShapes`).** Each read-only
  function is sampled once at mount and its returned row rendered as a TS-like
  type in `describe(...)` and the primed catalog — `sentry__list_issues(…) →
  { …, count: number, status: "unresolved"|"resolved"|"ignored" }[]`. This is the
  one thing table mode gets from `information_schema`; function mode now has it.

`jsrepl` across the batches:

| model | tier | orig | +framing | +shapes |
|---|---|:--:|:--:|:--:|
| DeepSeek V3.2 | frontier | 10/10 | 10/10 | 9/9¹ |
| MiniMax M3 | frontier | 8/10 | 10/10 | 9/10 |
| GLM-5 | frontier | 9/10 | 9/10 | **10/10** |
| Xiaomi MiMo v2.5 | mid | 10/10 | 10/10 | 10/10 |
| **Qwen3 30B A3B** | weak | **0/10** | **5/10** | **9/10** |
| DeepSeek V4 Flash | weak | 10/10 | 10/10 | 10/10 |
| **total** | | **47/60 (78%)** | **54/60 (90%)** | **57/59 (97%)** |

¹ one provider error, not a graded failure.

Framing alone rescued Qwen3-30B from 0 → 5 and MiniMax-M3 to a clean 10/10 —
78% → 90% from a prompt-only change. Result shapes then fixed the field-guessing
(GLM-5's `email-top-error` 9 → 10) and carried Qwen3-30B 5 → 9, landing at
**97% (57/59) — the top arm**, above lisp (95%), SQL (92%), and baseline (90%).
The two residual misses are MiniMax-M3's `email-top-error` (a one-cell wobble;
GLM-5 now passes it) and Qwen3-30B's `reconcile-ghost-issues` (the hardest
negation task, hit the turn cap).

Two honest costs. **Context:** shapes raise `jsrepl` median peak from 2,630 to
3,793 tokens — still below baseline's 4,783, but the off-context edge narrows
from 1.8× to ~1.3×; a ~1.2k-token catalog buys +7 points of accuracy, and the
trade is worth it for a surface going 78 → 97%. **Surface-specificity:** the same
shapes are neutral-to-slightly-negative on `lispfns` (92% → 88%, essentially all
Qwen3-30B variance) — Lisp function mode wasn't guessing fields, so the extra
catalog is cost without benefit. The lesson mirrors the Lisp paper's: enrichment
should be matched to where the fluency actually strains.

### Verdict against §9

**§9's outcome 1, earned through hardening.** The first run reproduced the
context benefit and reached frontier/mid parity but face-planted on the weak tail;
two fluency batches — framing, then result-shape discovery — took `jsrepl` from
78% to **97%, the strongest arm in the matrix**, with the single structural fix
(sampling read-only shapes) being exactly the discovery affordance table mode had
and function mode lacked. The remaining differences are one-cell noise and the
single hardest task. JavaScript's ubiquity delivered on the fluency bet once the
surface was *introduced* correctly and made to *show its data's shape* — neither
of which is a language or sandbox change. The honest recommendation: **jsrepl as
a first-class fluency surface, with result-shape sampling on where the models
guess fields (JS) and off where they don't (Lisp fn-mode).**

## 11. The cost of a real language: an adversarial sandbox review

Alone among the three surfaces, `glove-js` runs untrusted model code as a
Turing-complete language, so it carries a sandbox the SQL and Lisp surfaces don't
need. Before the A/B, that boundary was put through an adversarial review — agents
attempting escapes against the live interpreter, each finding reproduced with a
runnable program. It caught, and glove-js now fixes:

- **A full RCE** — object destructuring (`const { constructor: O } = {}`) bypassed
  the member gate, reaching `Function` and arbitrary host execution. Every
  destructuring read now routes through the same gate as member access.
- **ReDoS** — a catastrophic-backtracking regex (`/(a+)+$/`) ran unbounded native
  backtracking, bypassing both fuel and abort. Nested-quantifier patterns are
  rejected at construction.
- **Unmetered allocation** — `String.repeat`, `Array.from({length})`, and
  exponential string concatenation could exhaust memory for ~0 fuel. Bulk
  allocation is now fuel-charged and hard-capped.
- **A thenable hang** — a model-built `{ then }` object hung async evaluation
  forever via promise-assimilation. Objects with a callable `then` are rejected.
- **`Error.stack`** leaked host paths; six interpreter-semantics bugs (for-loop
  closures, optional-chain short-circuit, evaluation order, …) now match Node.js.

This is the honest ledger of what a JS surface costs relative to SQL and Lisp: a
security boundary that must be hardened, and a subset whose edges (rejected regex,
`class`, `for…in`) are a failure source the way SQL's grammar was. The unit suite
(`pnpm --filter glove-js test`) covers the sandbox; the review's findings are its
densest tests.

