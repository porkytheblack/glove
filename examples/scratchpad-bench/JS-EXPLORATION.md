# Is the scratchpad a *JavaScript* REPL? — the fluency bet, taken to its limit

*A design exploration building on ["The Scratchpad Is a Database"](PAPER.md) and
["Is the Scratchpad a REPL?"](LISP-EXPLORATION.md). Status: **live A/B run** —
see §10.*

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

<!-- §10 (results) and §11 (adversarial review) filled from the live run. -->
