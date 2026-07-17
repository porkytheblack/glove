# glove-python

A **Python REPL for LLM tool use**. Instead of loading many tool definitions
into the context window, expose an agent's capabilities as **functions** in a
tiny, sandboxed Python interpreter it drives with ONE `execute_python` tool. The
model already writes Python fluently — so it discovers, calls, and composes
capabilities by writing programs.

It is the Python sibling of [`glove-js`](../glove-js) and
[`glove-lisp`](../glove-lisp): all three consume the same
[`ToolFn`](../glove-scratchpad/src/fns) catalog, so one set of functions mounts
on any surface unchanged. Pick the language your models are most fluent in.

```ts
import { PySession, mountPy } from "glove-python";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const session = PySession.create();
session.registerAll(await fnsFromMcp(githubConn));   // github__list_pull_requests, …

mountPy(agent, { session });
```

Now the model works entirely in Python through `execute_python`:

```python
prs = github.list_pull_requests(state="open")
stale = [p for p in prs if p["age_days"] > 30]
"all fresh" if len(stale) == 0 else f"{len(stale)} stale: " + ", ".join(str(p['number']) for p in stale)
```

One call. The rows never enter the model's context — only the answer string does.

## Why a REPL (and why Python)

The [scratchpad work](../../examples/scratchpad-bench/PAPER.md) showed that
folding an agent's capabilities behind ONE code-eval tool beats loading dozens
of tool definitions — on correctness, on context, and on cost — *because the
model computes over results in the sandbox instead of round-tripping every
intermediate through its context window*. The bet is **fluency**: the surface
must behave like something the model already knows. `glove-lisp` bets on
Clojure; `glove-js` bets on JavaScript; `glove-python` bets on **Python** — the
language most models reach for first when the task is "manipulate this data".

What the surface keeps from that work:

- **One tool, progressive in-band discovery.** Nothing is primed by default —
  the model discovers capabilities in tiers: `search("open pull requests")` jumps
  straight to matching functions, or it browses `servers()` → `fns("github")` →
  `describe("name")` (server list → a server's functions → one function's params +
  result shape). The same tiers exist as native tools (`search_functions` /
  `list_servers` / `list_functions` / `describe_function`), so a weak model can
  fire them as tool calls and a capable one can script the whole sweep in one
  program. Result shapes warm lazily — a function's row type is sampled the first
  time it's described, not for the whole catalog at mount. (`discovery: "full"`
  primes every signature up front for small catalogs; `"auto"` picks per size.)
- **Off-context data flow.** `prs = github.list_pull_requests()` stores the rows
  in the REPL and echoes only a summary; the model then works with `len(prs)`,
  `prs[:5]`, `[p["title"] for p in prs]`.
- **Branch in one program.** `if len(incidents) == 0: slack.post(...)` / `else: email.send(...)`
  — decide-and-act is ONE call, not a read, a look, and a second call.
- **Exactly-once effects by construction.** A tool call fires when its expression
  evaluates — there is no planner that might re-run it.
- **Persistent session.** Top-level names survive across `execute_python` calls,
  so the model builds up state without re-fetching.
- **Bounded output.** The value that crosses back into context is structurally
  elided (arrays past 25 items, strings past 300 chars) with a marker naming the
  true size.

## The language

A deliberately small subset — the Python a model reaches for when it thinks
"transform this data", and nothing else:

- Assignment and tuple unpacking, `def` and `lambda`, `if`/`elif`/`else`,
  `for`/`while` (with `break`/`continue`), `try`/`except`/`finally`, `raise`,
  `return`, the ternary `a if c else b`.
- **Comprehensions** (`[p for p in prs if p["is_cool"]]`, dict & set forms),
  **f-strings**, slicing (`x[1:5]`, `x[::-1]`), chained comparisons (`0 < n < 10`),
  `in`/`not in`, `and`/`or`/`not`, `//`/`**`/`%` arithmetic.
- Builtins: `len range enumerate zip sum min max sorted(key=,reverse=) reversed
  map filter any all abs round list dict set tuple str int float bool isinstance
  print` (captured), plus methods on `str`/`list`/`dict`/`set`. Dict rows support
  both `p["count"]` and `p.count`.
- **Tool calls take keyword arguments** — the Python-native shape:
  `github.list_pull_requests(state="open")` passes the ToolFn `{state: "open"}`
  (a single positional dict is also accepted).

Not in the language — and rejected with a targeted message, not gibberish:
`import`, `class`, `with`, decorators, `global`/`nonlocal`, `del`, `yield`,
`async`/`await`. **Dunder attributes** (`__class__`, `__globals__`, …) are
blocked — that is Python's sandbox-escape surface.

## How a program runs

`parse → validate → run`. [`@lezer/python`](https://github.com/lezer-parser/python)
(a pure-JS, no-WASM parser in acorn's lineage) parses the full program; a
CST→AST walk normalizes it to a small node set and rejects unsupported
constructs before anything executes. Then an async tree-walking evaluator runs
it with a **fuel budget** (per node + per loop back-edge, so `while True:` can't
hang), a **recursion-depth cap**, and **`AbortSignal`** support. Every `obj.attr`
read and `obj.method(...)` call goes through a sandbox boundary (`members.ts`)
that blocks **every dunder attribute** and exposes a fixed per-type method
allowlist. Because values are plain JS (there is no Python object graph to
climb), blocking `__`-access closes the classic
`().__class__.__bases__[0].__subclasses__()` escape at its first hop.

## Function mode: no table modeling

A capability is a [`ToolFn`](../glove-scratchpad/src/fns): a name, an optional
input schema (its own — JSON Schema or Zod), and a `call`. There are no columns,
no pushdown keys, no volatility classes to declare — which is exactly what makes
this the right surface when the tools are unknown up front (an arbitrary MCP
server discovered at runtime).

```ts
import { defineFn } from "glove-scratchpad";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { PySession } from "glove-python";

const session = PySession.create();

// A whole MCP server → functions:
session.registerAll(await fnsFromMcp(conn));

// Or author one inline:
session.register(defineFn({
  name: "email__send",
  input: z.object({ to: z.string(), subject: z.string() }),
  readOnlyHint: false,
  handler: (args) => sendEmail(args),
}));
```

A `__` in a function name becomes a namespace: `github__list_pull_requests`
binds both the flat name and `github.list_pull_requests`. **Calling an effectful
function FIRES it immediately** — there is no staging or undo (the write verb is
the function).

## The moving parts

| Concept | Code |
| --- | --- |
| A capability | `ToolFn` — the same catalog as glove-js / glove-lisp function mode (`defineFn` / `fnFromTool` / `fnsFromMcp`) |
| The interpreter | `PySession` — `execute(code)` returns `{ value, called, defined, defs, stdout, note }` |
| The single agent tool | `mountPy(glove, { session })` → folds `execute_python` and primes the model |
| Discovery | progressive by default — `search("…")` / `servers()` / `fns("server")` / `describe("name")` as REPL builtins, mirrored by the `search_functions` / `list_servers` / `list_functions` / `describe_function` tools; `discovery: "full" \| "auto"` primes signatures for small catalogs |
| The parser | `parseProgram(code)` — `@lezer/python` + a CST→AST normalizing walk |
| The sandbox boundary | attribute access mediated by `members.ts` (the security-critical file) |

## Framing: `execute_python` vs `execute_python_workflow`

The eval tool ships three interchangeable framings, chosen at mount time with
`frame` — the runtime is identical, only the tool NAME and the primed preamble
change:

```ts
mountPy(agent, { session });                     // frame: "repl"     → execute_python (default)
mountPy(agent, { session, frame: "program" });   // frame: "program"  → execute_python_program
mountPy(agent, { session, frame: "workflow" });  // frame: "workflow" → execute_python_workflow
```

The `workflow` framing never says "REPL"; it frames the call as ONE complete
program that carries the task start to finish and demotes cross-call persistence
to a retry-only recovery aid — countering the tendency of models to degrade the
surface into an incremental line-by-line session. See
[`examples/scratchpad-bench/FRAME-EXPLORATION.md`](../../examples/scratchpad-bench/FRAME-EXPLORATION.md)
for the A/B; `pyToolName(frame)` / `buildPyPreambleBody(frame)` expose the mapping.
Default is `repl`, so existing mounts are unchanged.

## Status

Draft v0.1 — a fluency exploration alongside `glove-js` and `glove-lisp`. The
evaluator subset and sandbox are covered by 68 unit tests
(`pnpm --filter glove-python test`), including the dunder-escape and `import os`
rejection cases; all 11 deterministic capability probes pass
(`pnpm --filter glove-scratchpad-bench probe:py`).

![Python is parity-class with the hardened JS and Lisp arms](../../examples/scratchpad-bench/figures/repl-pyab.svg)

A live A/B (6 models × 10 tasks × 3 function-mode arms, same servers/seed/graders
— see [`examples/scratchpad-bench/PY-EXPLORATION.md`](../../examples/scratchpad-bench/PY-EXPLORATION.md))
found `pyrepl` **parity-class with the hardened `jsrepl` and `lispfns`**: 88%
(53/60) vs 93% (56/60) each, a 3-cell gap in a 60-cell run driven entirely by
shared failure classes (two just-under-threshold id-list cells where frontier
models under-listed ids, per-repo argmax reasoning slips, and the weak model's
turn-cap tail) — **not** by any language or sandbox limit: no cell failed on a
parse error, a rejected construct, or a sandbox block, and all 11 deterministic
probes pass. Frontier/mid models drive Python as fluently as JavaScript (9–10/10
each). The off-context context benefit reproduces (median peak ~4.2k tokens/cell,
a fraction of folding ~32 tool defs). The verdict: a first-class fluency surface
— pick the language per model/deployment, since the three are separated by noise,
not capability.

## License

MIT.
