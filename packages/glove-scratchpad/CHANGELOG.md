# glove-scratchpad

## 2.0.0

### Minor Changes

- [#41](https://github.com/porkytheblack/glove/pull/41) [`7b4aa99`](https://github.com/porkytheblack/glove/commit/7b4aa9912c23540e5a91a6f3b2047b826de65297) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Add `defineModelFn` (`glove-scratchpad/fns`) — wrap any `ModelAdapter` as a
  delegated-judgement `ToolFn` the planner calls inside its program. The sub-model
  sees the input and returns a parsed value; the input never has to enter the
  planner's own context, making per-item delegation both an economy (a cheap model
  does the work) and a context boundary (the documents stay with the delegate).

  A classifier is a model fn with a YES/NO `parse`, a drafter returns text, an
  extractor parses JSON. Pair it with the optional `ModelFnUsage` accumulator
  (`newModelFnUsage`) to measure the delegated token/cost curve. New exports:
  `defineModelFn`, `newModelFnUsage`, `DefineModelFnSpec`, `ModelFnUsage`.

- [#43](https://github.com/porkytheblack/glove/pull/43) [`618528a`](https://github.com/porkytheblack/glove/commit/618528a4d135b35830c0ccf7176f9c22e1913be0) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Fold the native discovery TOOL names into the REPL so models primed on them land their call.

  The function-mode REPLs already exposed progressive discovery two ways: as native tools (`search_functions` / `list_servers` / `list_functions` / `describe_function`) and as short in-REPL builtins (`search` / `servers` / `fns` / `describe`). But a model primed on the tool names routinely tries to call `search_functions(...)` / `list_functions(...)` _inside_ the eval program, where only the short names existed — so the call silently failed.

  - **glove-scratchpad/fns** — new shared source of truth for the discovery builtin names: `DISCOVERY_BUILTINS` (short + native-tool alias per tier), `DISCOVERY_BUILTIN_NAMES`, and `discoveryArg` / `hasDiscoveryArg` (read a call's argument from either a positional value or the tool's object form). Exported from `glove-scratchpad` and `glove-scratchpad/fns`.
  - **glove-js** — the native-tool names are now callable in-REPL as aliases of the short builtins: `search_functions({ query })`, `list_functions({ server })`, `list_servers()`, `describe_function({ name })` — each accepting the `{ … }` object form OR a bare positional value. The names are reserved (a capability can't be registered under them).
  - **glove-python** — same aliases, accepting a keyword arg (`search_functions(query=…)`), a positional string, or a dict.
  - **glove-lisp** — same aliases bound to the identical handlers: `(list_functions :github)`, `(search_functions "send email")`, `(list_servers)`, `(describe_function :name)`.

  Priming text on all three surfaces now tells the model both name forms work inside the code. Purely additive — the short names and the native tools are unchanged.

### Patch Changes

- [#44](https://github.com/porkytheblack/glove/pull/44) [`ae39b72`](https://github.com/porkytheblack/glove/commit/ae39b725b244e147999e71d416a74447ca1b2169) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Exclude tools from an MCP server — one knob that bubbles through every mount path.

  A server often exposes tools you don't want the model to reach (dangerous writes, noisy duplicates, capabilities your app handles itself). There was no way to drop them from the main `mountMcp` path.

  - **`McpCatalogueEntry.excludeTools?: string[]`** — per-server exclusion by exact, un-namespaced tool name.
  - **`connectMcp`** gains `excludeTools?: string[]` and `filterTools?: (tool) => boolean`. The filter runs inside `listTools()`, so excluded tools are dropped at the connection — which means they never reach ANY consumer: the boot-time reload, the `discovermcp` subagent's `activate`, and any `glove-scratchpad` bridge (`mcpResources` / `fnsFromMcp`) built over the same connection all bridge exactly the filtered listing.
  - **`mountMcp`** (and the discovery subagent) gain `filterTools?: (tool, entry) => boolean` for catalogue-wide rules, applied on top of each entry's `excludeTools` — e.g. drop every destructive tool across all servers.
  - **`includeTool(tool, { excludeTools, filterTools })`** — the exported pure drop predicate `connectMcp` applies.

  Only the tool _listing_ is filtered; `conn.raw` and a direct `conn.callTool(name, …)` are left untouched as an advanced escape hatch.

  `glove-scratchpad`: no API change — the `mcpResources` / `fnsFromMcp` bridges already read `conn.listTools()`, so they inherit connection-level exclusion for free. Docs clarify that setting `excludeTools` on `connectMcp` is how you keep tools off the scratchpad surfaces (the existing `table` / `filter` skip predicates remain the finer per-bridge control).

- Updated dependencies [[`ae39b72`](https://github.com/porkytheblack/glove/commit/ae39b725b244e147999e71d416a74447ca1b2169)]:
  - glove-mcp@1.1.0
