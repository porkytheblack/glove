# glove-lisp

## 0.4.0

### Minor Changes

- [#40](https://github.com/porkytheblack/glove/pull/40) [`5807ad0`](https://github.com/porkytheblack/glove/commit/5807ad0d497d51e0bc89b84571d6c1930529767e) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Eval-tool framing: choose `execute_*` vs `execute_*_program` vs `execute_*_workflow` at mount time. All three surfaces (`glove-js`, `glove-python`, `glove-lisp`) now take a `frame` option on the mount config and tool builders — `"repl"` (default, unchanged: `execute_js` / `execute_python` / `execute_lisp`), `"program"` (`execute_*_program`), or `"workflow"` (`execute_*_workflow`, plus `explain_lisp_workflow` for the Lisp explain companion). The runtime is identical across framings — only the tool NAME and the primed preamble change. The `workflow` framing actively de-REPLs the priming (author the WHOLE task as one program; cross-call persistence is demoted to a retry-only recovery aid) to counter models degrading the single-eval surface back into an incremental, line-by-line tool-call loop. New exports: `Frame` type, `jsToolName` / `pyToolName` / `lispToolName` / `lispExplainName`, `buildJsPreambleBody` / `buildPyPreambleBody` / `buildLispResourcePreamble` / `buildLispFnPreamble`, and `buildDiscoveryTools` (glove-js). Default is `repl`, so existing mounts are byte-for-byte unchanged. See `benches/scratchpad-bench/FRAME-PAPER.md` for the A/B benchmark, the discovery-mode contrast, and the revealed-preference (choice) study that motivated it.

- [#43](https://github.com/porkytheblack/glove/pull/43) [`618528a`](https://github.com/porkytheblack/glove/commit/618528a4d135b35830c0ccf7176f9c22e1913be0) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Fold the native discovery TOOL names into the REPL so models primed on them land their call.

  The function-mode REPLs already exposed progressive discovery two ways: as native tools (`search_functions` / `list_servers` / `list_functions` / `describe_function`) and as short in-REPL builtins (`search` / `servers` / `fns` / `describe`). But a model primed on the tool names routinely tries to call `search_functions(...)` / `list_functions(...)` _inside_ the eval program, where only the short names existed — so the call silently failed.

  - **glove-scratchpad/fns** — new shared source of truth for the discovery builtin names: `DISCOVERY_BUILTINS` (short + native-tool alias per tier), `DISCOVERY_BUILTIN_NAMES`, and `discoveryArg` / `hasDiscoveryArg` (read a call's argument from either a positional value or the tool's object form). Exported from `glove-scratchpad` and `glove-scratchpad/fns`.
  - **glove-js** — the native-tool names are now callable in-REPL as aliases of the short builtins: `search_functions({ query })`, `list_functions({ server })`, `list_servers()`, `describe_function({ name })` — each accepting the `{ … }` object form OR a bare positional value. The names are reserved (a capability can't be registered under them).
  - **glove-python** — same aliases, accepting a keyword arg (`search_functions(query=…)`), a positional string, or a dict.
  - **glove-lisp** — same aliases bound to the identical handlers: `(list_functions :github)`, `(search_functions "send email")`, `(list_servers)`, `(describe_function :name)`.

  Priming text on all three surfaces now tells the model both name forms work inside the code. Purely additive — the short names and the native tools are unchanged.

### Patch Changes

- Updated dependencies [[`ae39b72`](https://github.com/porkytheblack/glove/commit/ae39b725b244e147999e71d416a74447ca1b2169), [`7b4aa99`](https://github.com/porkytheblack/glove/commit/7b4aa9912c23540e5a91a6f3b2047b826de65297), [`618528a`](https://github.com/porkytheblack/glove/commit/618528a4d135b35830c0ccf7176f9c22e1913be0)]:
  - glove-scratchpad@2.0.0
