# glove-lisp

**A Lisp REPL for LLM tool use.** Instead of loading dozens of tool definitions
into the context window, expose an agent's capabilities as **functions in a
tiny, sandboxed, Clojure-flavored Lisp** it drives with a single `execute_lisp`
tool. The model discovers, invokes, composes — and *branches* — by writing
programs; only the value of the last form ever enters its context.

This is the sibling of [`glove-scratchpad`](../glove-scratchpad) (the SQL
surface), built on the **same `ResourceTable` contract** — one resource catalog
mounts on either surface:

```clojure
;; discover what you can do
(tables)
(describe :github_pull_requests)

;; invoke a capability by calling it; push arguments as a map
(count (github_pull_requests {:state "open"}))

;; keep big intermediates in the REPL, out of your context
(def prs (github_pull_requests))     ; echoes {:defined "prs" :count 320} — not 320 rows
(frequencies :state prs)

;; compose across services in one program — no intermediate rows in context
(let [done (->> (linear_issues) (filter #(= (:state %) "done")) (map :id))]
  (->> (github_pull_requests {:state "merged"})
       (filter #(and (:closes_linear %) (not (contains? done (:closes_linear %)))))
       (count)))

;; BRANCH in one call — decide-and-act, the composition SQL can't express
(if (empty? (pagerduty_incidents {:urgency "high" :status "triggered"}))
  (insert! :slack_messages {:channel "ops" :text "All clear."})
  (insert! :emails {:to_addr "oncall@acme.io" :subject "Incidents live" :body "…"}))

;; stage several outbound effects, preview them, then fire (or discard — a dry run)
(stage (insert! :emails {:to_addr "a@b.io" :subject "one" :body "…"})
       (insert! :emails {:to_addr "c@d.io" :subject "two" :body "…"}))
(commit!)   ; or (rollback!)
```

```bash
pnpm add glove-lisp
# zero runtime dependencies beyond glove-core / glove-scratchpad (types + resource contract)
```

## Quick start

```ts
import { LispSession, mountLisp } from "glove-lisp";
import { defineResource } from "glove-scratchpad";

const session = LispSession.create({ policy: { writes: true } });

session.register(defineResource({
  name: "github_pull_requests",
  volatility: "stable",
  columns: [
    { name: "number", type: "bigint" },
    { name: "state", type: "text", description: "open | merged | closed" },
    { name: "title", type: "text" },
  ],
  select: (b) => listPrs({ state: b.one("state") }),
}));

// Fold the single tool + prime the model to discover → read → compute → act.
mountLisp(agent, { session, allowWrites: true });
```

Now the model works entirely in Lisp through `execute_lisp` (and `explain_lisp`).

## Function mode (when you don't want to model tables)

The `ResourceTable` contract above asks you to model each capability as an
entity — columns, required-key pushdown, a volatility class. That is the right
shape when the data is worth querying and the wrong amount of ceremony when the
tools are unknown up front (an arbitrary MCP server discovered at runtime has no
columns to declare). **Function mode** is the light path: register a
[`ToolFn`](../glove-scratchpad/src/fns) and calling it invokes the underlying
tool with your argument map, returning its data verbatim.

```ts
import { LispSession, mountLisp } from "glove-lisp";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { defineFn } from "glove-scratchpad";

const session = LispSession.create();

// A whole MCP server → functions, no table specs:
session.registerFns(await fnsFromMcp(githubConn));   // github__list_pull_requests, …

// Or author one inline:
session.registerFn(defineFn({
  name: "email__send",
  input: z.object({ to: z.string(), subject: z.string() }),
  readOnlyHint: false,
  handler: (args) => sendEmail(args),
}));

mountLisp(agent, { session });
```

The model then works the same way, but calls are plain function applications:

```clojure
(if (empty? (github__list_pull_requests {:state "open"}))
  (email__send {:to "ops@acme.io" :subject "no open PRs"})
  (def prs (github__list_pull_requests {:state "open"})))
```

- **No columns, no pushdown, no `WHERE`-filtering.** The argument map is the
  tool's input, verbatim; the result is whatever the tool returns.
- **No `insert!`/`update!`/`delete!`, no staging.** The write verb *is* the
  function — a call **fires immediately**, always (the `writes` policy and
  `(stage …)` do not apply). Register effectful functions only on a session you
  are comfortable firing.
- **Discovery is progressive** — nothing is primed by default. `(search "open
  pull requests")` jumps to matching functions; or browse `(servers)` → `(fns
  :github)` → `(describe :name)` (servers → a server's functions → one function's
  params + result shape, required ones marked). The same tiers are also native
  tools (`search_functions` / `list_servers` / `list_functions` /
  `describe_function`), so a weak model fires them as tool calls and a capable one
  scripts the sweep in one program; result shapes warm lazily on first `describe`.
  (`discovery: "full"` primes every signature for small catalogs.)
- Everything else is identical: `def` persistence, structural elision, loud
  errors with did-you-mean, the fuel/depth budget.
- **Functions and resources coexist** in one session — `(tables)` lists
  resources, `(fns)` lists functions; a name backs only one of them.

## Why a Lisp (when the SQL emulator already works)

The [scratchpad benchmark](../../benches/scratchpad-bench/PAPER.md) showed the
SQL surface beats direct tool-folding on correctness, context, and cost — and
named two honest limits. Both are structural to SQL, and both dissolve in a
Lisp:

1. **Conditional composition.** `IF the incident list is empty THEN post to
   Slack ELSE email oncall` cannot be one SQL statement — it's a query, a look,
   and a second query. In Lisp it is one `(if …)` form: decide-and-act in a
   single call, with the data never entering context between the decision and
   the action.
2. **Exactly-once effects needed a whole subsystem.** The SQL engine's planner
   may lazily re-evaluate a relation N times, so the emulator pre-resolves every
   resource before the engine runs. A strict call-by-value evaluator has no
   planner: a resource call fires when its form is evaluated, exactly once, by
   construction.

Two more properties come free:

- **The program is the syntax tree.** SQL bought its inspection surface (gate,
  EXPLAIN, statement whitelist) with a parser. S-expressions *are* the tree —
  `explain_lisp` is a plain tree walk, and there is no grammar corner (a
  `RETURNING` eaten as an alias, a data-modifying CTE) to silently mis-parse.
- **The REPL is the scratchpad.** `def` keeps named intermediates in the session
  across calls. The SQL surface has nothing like it (its gate refuses
  `CREATE TABLE AS`); here it's the idiomatic move, and `def` deliberately
  echoes a summary (`{:defined "prs" :count 320}`) instead of the value.

The open question — the reason this is an exploration and not a conclusion — is
**fluency**: SQL's superpower is that every model, at every size, already
drives it like Postgres. Models write Clojure well, but the weak-model tail is
unproven. The benchmark's lisp arm exists to measure exactly that.

## The moving parts

| Concept | Code |
| --- | --- |
| Resource (a function) | `ResourceTable` — **the same contract as glove-scratchpad** (`defineResource` / `resourceFromTool` / `mcpResources` all work) |
| The interpreter | `LispSession` — `execute(code)` / `explainProgram` |
| The single agent tool | `mountLisp(glove, { session })` → folds `execute_lisp` + `explain_lisp` |
| Discovery | `(tables)`, `(describe :name)` + a primed catalog in the system prompt |
| Writes | `(insert! :t {…})`, `(update! :t {set} {match})`, `(delete! :t {match})` |
| Staging | `(stage …)` → `(commit!)` / `(rollback!)`; `session.preview()` is the approval surface |

## Framing: `execute_lisp` vs `execute_lisp_workflow`

The eval tool ships three interchangeable framings, chosen at mount time with
`frame` — the runtime is identical, only the tool NAMES and the primed preamble
change (the `explain_lisp` companion follows the frame too):

```ts
mountLisp(agent, { session });                     // frame: "repl"     → execute_lisp / explain_lisp (default)
mountLisp(agent, { session, frame: "program" });   // frame: "program"  → execute_lisp_program / explain_lisp_program
mountLisp(agent, { session, frame: "workflow" });  // frame: "workflow" → execute_lisp_workflow / explain_lisp_workflow
```

The `workflow` framing never says "REPL"; it frames the call as ONE complete
program that carries the task start to finish and demotes cross-call `def`
persistence to a retry-only recovery aid — countering the tendency of models to
degrade the surface into an incremental form-by-form session. See
[`benches/scratchpad-bench/FRAME-PAPER.md`](../../benches/scratchpad-bench/FRAME-PAPER.md)
for the A/B; `lispToolName(frame)` / `buildLispFnPreamble(frame)` expose the
mapping. Default is `repl`, so existing mounts are unchanged.

## The language

Deliberately tiny — the Clojure subset a model reaches for when it thinks
"data manipulation", and nothing else:

- **Special forms**: `if` `when` `cond` `do` `let` `fn` `defn` `def` `and` `or`
  `->` `->>` `quote` `stage`
- **Data**: numbers, strings, `:keywords`, `[vectors]`, `{:maps "values"}`,
  `nil`/`true`/`false`; `#(… % …)` lambda shorthand; `,` is whitespace; `;` comments
- **Library** (~80 fns): `map filter remove reduce count first last take drop
  sort sort-by distinct group-by frequencies max-key min-key sum avg some
  every? empty? contains? concat flatten range apply comp partial get get-in
  assoc dissoc merge select-keys update keys vals str upper-case lower-case
  includes? starts-with? ends-with? split join replace subs …` (string fns also
  answer to their `str/…` and `clojure.string/…` spellings)
- **No** `loop`/`recur`/`while`/`eval`/interop. Iteration is `map`/`filter`/
  `reduce`; a **fuel budget** (charged per form and per element in bulk ops)
  plus a recursion-depth cap bound runaway work.

The data model is JSON-native: rows from a resolver are plain maps, zero
shaping. Keywords coerce to their name where data is concerned — `(= (:state
pr) :open)` is true when the value is `"open"`, a deliberate mercy in the
*silently right* direction.

## How a program runs

1. **Read** the whole program into a syntax tree (nothing has run).
2. **Gate**: writes are off unless the session (and the mounted tool) allow
   them; `stage` defers them; the fuel/depth budget is armed.
3. **Evaluate** strictly, in order. A resource call = one resolver invocation
   (per the volatility model). Arguments push down as a `{:col value}` map —
   required-key columns must be present (the error names them), vector values
   fan out like `IN`, and every bound column is *also* re-filtered over the
   returned rows, so pushdown holds even when a resolver ignores an argument.
4. **Return** the last form's value, **structurally elided** (arrays beyond 25
   items, strings beyond 300 chars, depth beyond 6 — each marker names the true
   size and the fix: `count` / `take` / `def`).

## Volatility

Same model as the SQL emulator, same declarations, one big simplification:

- **immutable** — cached for the session's lifetime.
- **stable** — cached within one `execute` (a turn-stable read).
- **volatile** — never cached; invoked exactly once per call site *because
  that's what evaluation means*, not because a subsystem enforces it.

## Writes: fired, staged, and readable back

- A bare `(insert! …)` **fires immediately** and returns its row count — the
  command tag (`insert! on "emails" fired — 1 row(s)`) makes verification reads
  unnecessary.
- `(stage w1 w2 …)` records writes with their exact resolver arguments and fires
  nothing; the result is the preview. `(commit!)` fires in order; `(rollback!)`
  discards. Writing outside the stage while writes are pending is refused, with
  the fix named.
- **Read-your-writes**: fired writes fold into subsequent reads of the same
  resource for the rest of the session (inserts append, updates patch, deletes
  drop) — the verification instinct is *correct* rather than forbidden.

## Error UX

Every error names the next action, because errors are the model's steering:

```
unknown symbol 'cont' — did you mean 'count'? Run (tables) to list your capabilities…
resource "slack_messages" requires :channel — call (slack_messages {:channel …})
resource "github_pull_requests" has no column :stat — did you mean :state? Columns: :number, :state, …
(:title …) was given a list of 40 item(s), not a map — did you mean (map :title the-list)?
computation budget exceeded — … filter/take before mapping, use (count …) instead of materializing
```

## What this is not

- **Not Clojure.** No lazy seqs, no protocols, no namespaces, no macros beyond
  the built-in threading forms. If a model writes outside the subset it gets a
  loud error with a suggestion, not a silent misparse.
- **Not a sandbox for arbitrary computation.** The fuel budget is a real
  ceiling; heavy analytics belong in a resolver (or the SQL surface), not in
  interpreted Lisp.
- **Not a replacement for the SQL surface (yet).** Set-at-a-time analytics over
  large tables reads more naturally in SQL, and SQL fluency in the weakest
  models is proven where Lisp fluency is hypothesized. See the
  [exploration writeup](../../benches/scratchpad-bench/LISP-EXPLORATION.md).

## Status

Exploration. The interpreter and surface are complete and tested (45 unit
tests; a deterministic probe drives all seven benchmark scenarios through the
surface); the model-in-the-loop A/B against the SQL arm is wired
(`pnpm bench --arms=baseline,scratchpad,lisp`) and not yet run.

## License

MIT
