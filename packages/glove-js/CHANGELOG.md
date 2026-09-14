# glove-js

## 0.5.0

### Minor Changes

- [#176](https://github.com/porkytheblack/glove/pull/176) [`8c36feb`](https://github.com/porkytheblack/glove/commit/8c36feb1139966bcdac8525e79db1714c13c5b6b) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Integrate Foundry's production application controls with the current core runtime-context and multimodal contracts. Add durable single-host Foundry data, authoritative conversation transcripts, adapter-owned HTTP authorization, expiring tool approvals, interrupt-and-restart steering, and bounded programmatic tool composition. Preserve message-aware assembly, schedules, sleep, native working environments, and voice host boundaries.

  Add first-class lazy goals, facts, forms and native context-provider fields with typed execution handles, conversation/instance scoping, opt-in shared preparation, and metadata-only inspector progress. Extend the SQLite bundle with durable native goal/form adapters and independently committed fact saves protected by process-death-safe SQLite locks. Add guided-intake documentation and restart/concurrency tests.

  Require Station 2.3.0 or newer for completed-worker drain and cancellation escalation fixes. Add a real-process regression for leaked handles and cancellation.

  Add a Clack-based interactive project initializer with target, starter and package-manager choices, a review before writing files, cancellation and optional dependency installation. Preserve non-interactive automation with explicit flags. Require Node 20.12+ for the initializer (Node 22.13+ recommended for SQLite memory). Resolve scaffold versions against the installed workspace instead of obsolete fallback majors. Expand the package and starter READMEs and the documentation site's setup wizard and CLI reference.

  Add opt-in `glove-memory/sqlite` durable entity, episodic, resource and pinned-context adapters for Node 22.13+ with isolated namespaces, transactional writes, cross-process reads and corruption checks. Existing browser-safe entry points remain unchanged.

  Add MCP stdio transport, tool allowlists, sanitized resources and prompts, bounded timeouts, lease-safe child recycling, live tool refresh and deactivation cleanup. Core tool-registry updates are atomic; Gemini compatibility retains provider thought signatures across tool turns. REPL workflow frames remain bounded and capability-selected.

### Patch Changes

- Updated dependencies [[`8c36feb`](https://github.com/porkytheblack/glove/commit/8c36feb1139966bcdac8525e79db1714c13c5b6b)]:
  - glove-core@4.1.0
  - glove-scratchpad@3.0.0

## 0.4.3

### Patch Changes

- Updated dependencies []:
  - glove-core@4.0.0
  - glove-scratchpad@2.0.3

## 0.4.2

### Patch Changes

- Updated dependencies [e6210d0]
  - glove-core@3.7.1
  - glove-scratchpad@2.0.2

## 0.4.1

### Patch Changes

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0
  - glove-scratchpad@2.0.1

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

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ae39b72`](https://github.com/porkytheblack/glove/commit/ae39b725b244e147999e71d416a74447ca1b2169), [`7b4aa99`](https://github.com/porkytheblack/glove/commit/7b4aa9912c23540e5a91a6f3b2047b826de65297), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`618528a`](https://github.com/porkytheblack/glove/commit/618528a4d135b35830c0ccf7176f9c22e1913be0), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
  - glove-scratchpad@2.0.0
