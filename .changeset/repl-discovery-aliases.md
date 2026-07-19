---
"glove-scratchpad": minor
"glove-js": minor
"glove-python": minor
"glove-lisp": minor
---

Fold the native discovery TOOL names into the REPL so models primed on them land their call.

The function-mode REPLs already exposed progressive discovery two ways: as native tools (`search_functions` / `list_servers` / `list_functions` / `describe_function`) and as short in-REPL builtins (`search` / `servers` / `fns` / `describe`). But a model primed on the tool names routinely tries to call `search_functions(...)` / `list_functions(...)` *inside* the eval program, where only the short names existed — so the call silently failed.

- **glove-scratchpad/fns** — new shared source of truth for the discovery builtin names: `DISCOVERY_BUILTINS` (short + native-tool alias per tier), `DISCOVERY_BUILTIN_NAMES`, and `discoveryArg` / `hasDiscoveryArg` (read a call's argument from either a positional value or the tool's object form). Exported from `glove-scratchpad` and `glove-scratchpad/fns`.
- **glove-js** — the native-tool names are now callable in-REPL as aliases of the short builtins: `search_functions({ query })`, `list_functions({ server })`, `list_servers()`, `describe_function({ name })` — each accepting the `{ … }` object form OR a bare positional value. The names are reserved (a capability can't be registered under them).
- **glove-python** — same aliases, accepting a keyword arg (`search_functions(query=…)`), a positional string, or a dict.
- **glove-lisp** — same aliases bound to the identical handlers: `(list_functions :github)`, `(search_functions "send email")`, `(list_servers)`, `(describe_function :name)`.

Priming text on all three surfaces now tells the model both name forms work inside the code. Purely additive — the short names and the native tools are unchanged.
