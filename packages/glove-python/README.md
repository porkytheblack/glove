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

- **One tool, in-band discovery.** `fns()` lists your functions; `describe("name")`
  shows a function's parameters. The primed catalog means the model rarely needs to.
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
| Discovery | `fns()`, `describe("name")` + a primed catalog in the system prompt |
| The parser | `parseProgram(code)` — `@lezer/python` + a CST→AST normalizing walk |
| The sandbox boundary | attribute access mediated by `members.ts` (the security-critical file) |

## Status

Draft v0.1 — a fluency exploration alongside `glove-js` and `glove-lisp`. The
evaluator subset and sandbox are covered by 68 unit tests
(`pnpm --filter glove-python test`), including the dunder-escape and `import os`
rejection cases; all 11 deterministic capability probes pass
(`pnpm --filter glove-scratchpad-bench probe:py`).

<!-- AB-RESULTS -->

## License

MIT.
