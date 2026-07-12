# fn-repl-agent — function mode on both REPL surfaces

Capabilities as plain **functions** (no table modeling), driven by both
[`glove-lisp`](../../packages/glove-lisp) and [`glove-js`](../../packages/glove-js)
over ONE shared [`ToolFn`](../../packages/glove-scratchpad/src/fns) catalog. No
API key, no model, no database — it drives `session.execute(...)` directly so the
transcript is deterministic.

```bash
pnpm --filter glove-fn-repl-example lisp   # the Clojure surface
pnpm --filter glove-fn-repl-example js     # the JavaScript surface
pnpm --filter glove-fn-repl-example both   # both, over the same functions
```

## What it shows

Four fake capabilities register as `ToolFn`s via `defineFn` — no columns, no
pushdown keys, no volatility. The same catalog mounts on each surface, and each
proves the load-bearing properties:

- **Discovery in-band** — `(fns)` / `fns()`, `(describe :name)` / `describe("name")`.
- **Call by name** — arguments as one map/object; the underlying tool fires.
- **Compose off-context** — filter/map/join across capabilities inside one
  program; the rows never leave the REPL.
- **Persist** — `(def …)` / top-level `const` keeps big intermediates in the
  session; a reuse does not re-fetch (watch the call counts).
- **Decide-and-act** — `if` / ternary picks which effect fires, in a single call.

The final call-count summary shows each capability fired exactly when its form
evaluated — the exactly-once-by-construction property both surfaces share.

## In a real agent

Swap the direct `execute` calls for a mount and let the model write the programs:

```ts
import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
import { mountLisp } from "glove-lisp";        // or mountJs from "glove-js"

session.registerFns(await fnsFromMcp(conn));   // a whole MCP server → functions
mountLisp(agent, { session });
```
