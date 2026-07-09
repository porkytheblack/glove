# glove-js

A **JavaScript REPL for LLM tool use**. Instead of loading many tool
definitions into the context window, expose an agent's capabilities as async
**functions** in a tiny, sandboxed JS interpreter it drives with ONE
`execute_js` tool. The model already writes JavaScript fluently — so it
discovers, calls, and composes capabilities by writing programs.

It is the JavaScript sibling of [`glove-lisp`](../glove-lisp): both consume the
same [`ToolFn`](../glove-scratchpad/src/fns) catalog, so one set of functions
mounts on either surface unchanged. Pick the language your models are most
fluent in.

```ts
import { JsSession, mountJs } from "glove-js";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";

const session = JsSession.create();
session.registerAll(await fnsFromMcp(githubConn));   // github__list_pull_requests, …

mountJs(agent, { session });
```

Now the model works entirely in JavaScript through `execute_js`:

```js
const prs = github.list_pull_requests({ state: "open" });
const stale = prs.filter(p => p.age_days > 30);
stale.length === 0
  ? "all fresh"
  : `${stale.length} stale: ${stale.map(p => p.number).join(", ")}`;
```

One call. The rows never enter the model's context — only the answer string does.

## Why a REPL (and why JavaScript)

The [scratchpad work](../../examples/scratchpad-bench/PAPER.md) showed that
folding an agent's capabilities behind ONE code-eval tool beats loading dozens
of tool definitions — on correctness, on context, and on cost — *because the
model computes over results in the sandbox instead of round-tripping every
intermediate through its context window*. The bet is **fluency**: the surface
must behave like something the model already knows. `glove-lisp` bets on
Clojure; `glove-js` bets on JavaScript — the single most-represented language
in every model's training data.

What the surface keeps from that work:

- **One tool, in-band discovery.** `fns()` lists your functions; `describe("name")`
  shows a function's parameters. The primed catalog means the model rarely needs to.
- **Off-context data flow.** `const prs = github.list_pull_requests()` stores the
  rows in the REPL and echoes only a summary; the model then works with
  `prs.length`, `prs.slice(0, 5)`, `prs.map(p => p.title)`.
- **Branch in one program.** `if (incidents.length === 0) slack.post(...) else email.send(...)`
  — decide-and-act is ONE call, not a read, a look, and a second call.
- **Exactly-once effects by construction.** A tool call fires when its expression
  evaluates — there is no planner that might re-run it.
- **Persistent session.** Top-level `const`/`let` survive across `execute_js`
  calls, so the model builds up state without re-fetching.
- **Bounded output.** The value that crosses back into context is structurally
  elided (arrays past 25 items, strings past 300 chars) with a marker naming the
  true size.

## The language

A deliberately small subset — the JavaScript a model reaches for when it thinks
"transform this data", and nothing else:

- `const`/`let`, arrow functions and function declarations, template literals,
  destructuring (defaults + `...rest`), spread, optional chaining (`?.`).
- `if`/`else`, `for…of`, `for`, `while`, `switch`, `try`/`catch`/`finally`,
  `throw`.
- Arrays (`map`/`filter`/`reduce`/`find`/`some`/`every`/`sort`/`flatMap`/`slice`/…),
  strings, `Object.keys`/`values`/`entries`/`assign`/`fromEntries`, `Math`,
  `JSON`, `new Set`/`Map`/`Date`/`RegExp`, `console.log` (captured).
- **Tool calls** are async functions; promises resolve automatically, so `await`
  is optional. `github.list_pull_requests({ state: "open" })` just works.

Not in the language — and rejected with a targeted message, not gibberish:
`class`, `import`/`require`, `eval`, `Function`, `this`, prototypes, `fetch`,
`for…in`, `var`, `in`/`instanceof`, generators.

## How a program runs

`parse → validate → run`. acorn parses the full program; a whitelist walk
rejects unsupported constructs before anything executes. Then an async
tree-walking evaluator runs it with a **fuel budget** (per node + per loop
back-edge, so `while (true) {}` can't hang), a **recursion-depth cap**, and
**`AbortSignal`** support. Every `obj.prop` read and `obj.method(...)` call goes
through a sandbox boundary (`members.ts`) that blocks the escape keys
(`constructor`, `__proto__`, `prototype`, `call`/`apply`/`bind`) and exposes a
fixed method allowlist — a program can't climb a constructor chain back to the
host.

## Function mode: no table modeling

A capability is a [`ToolFn`](../glove-scratchpad/src/fns): a name, an optional
input schema (its own — JSON Schema or Zod), and a `call`. There are no columns,
no pushdown keys, no volatility classes to declare — which is exactly what makes
this the right surface when the tools are unknown up front (an arbitrary MCP
server discovered at runtime).

```ts
import { defineFn } from "glove-scratchpad";
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { JsSession } from "glove-js";

const session = JsSession.create();

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
| A capability | `ToolFn` — the same catalog as glove-lisp's function mode (`defineFn` / `fnFromTool` / `fnsFromMcp`) |
| The interpreter | `JsSession` — `execute(code)` returns `{ value, called, defined, defs, stdout, note }` |
| The single agent tool | `mountJs(glove, { session })` → folds `execute_js` and primes the model |
| Discovery | `fns()`, `describe("name")` + a primed catalog in the system prompt |
| The parser | `parseProgram(code)` — acorn + a whitelist validation walk |
| The sandbox boundary | member access mediated by `members.ts` (the security-critical file) |

## Status

Draft v0.1 — a fluency exploration alongside `glove-lisp`. The evaluator subset
and sandbox are covered by unit tests (`pnpm --filter glove-js test`), and the
sandbox boundary survived an adversarial escape review.

A first live A/B (6 models × 10 tasks × 5 arms — see
[`examples/scratchpad-bench/JS-EXPLORATION.md`](../../examples/scratchpad-bench/JS-EXPLORATION.md))
found that `execute_js` reproduces the SQL/Lisp **off-context benefit** (1.8×
less peak context than folding every tool) and is fully competitive on frontier
and mid-tier models, while **function mode reaches parity with the ResourceTable
contract**. Its one weak-tail failure cluster is a preamble *framing* gap (the
weakest model called the catalog functions as if they were folded tools instead
of writing an `execute_js` program), not a language or sandbox problem — the
same kind of gap the Lisp surface closed over successive fluency batches.

## License

MIT.
