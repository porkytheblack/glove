# glove-mcp

## 1.2.0

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

## 1.1.3

### Patch Changes

- Updated dependencies []:
  - glove-core@4.0.0

## 1.1.2

### Patch Changes

- Updated dependencies [e6210d0]
  - glove-core@3.7.1

## 1.1.1

### Patch Changes

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0

## 1.1.0

### Minor Changes

- [#44](https://github.com/porkytheblack/glove/pull/44) [`ae39b72`](https://github.com/porkytheblack/glove/commit/ae39b725b244e147999e71d416a74447ca1b2169) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Exclude tools from an MCP server — one knob that bubbles through every mount path.

  A server often exposes tools you don't want the model to reach (dangerous writes, noisy duplicates, capabilities your app handles itself). There was no way to drop them from the main `mountMcp` path.

  - **`McpCatalogueEntry.excludeTools?: string[]`** — per-server exclusion by exact, un-namespaced tool name.
  - **`connectMcp`** gains `excludeTools?: string[]` and `filterTools?: (tool) => boolean`. The filter runs inside `listTools()`, so excluded tools are dropped at the connection — which means they never reach ANY consumer: the boot-time reload, the `discovermcp` subagent's `activate`, and any `glove-scratchpad` bridge (`mcpResources` / `fnsFromMcp`) built over the same connection all bridge exactly the filtered listing.
  - **`mountMcp`** (and the discovery subagent) gain `filterTools?: (tool, entry) => boolean` for catalogue-wide rules, applied on top of each entry's `excludeTools` — e.g. drop every destructive tool across all servers.
  - **`includeTool(tool, { excludeTools, filterTools })`** — the exported pure drop predicate `connectMcp` applies.

  Only the tool _listing_ is filtered; `conn.raw` and a direct `conn.callTool(name, …)` are left untouched as an advanced escape hatch.

  `glove-scratchpad`: no API change — the `mcpResources` / `fnsFromMcp` bridges already read `conn.listTools()`, so they inherit connection-level exclusion for free. Docs clarify that setting `excludeTools` on `connectMcp` is how you keep tools off the scratchpad surfaces (the existing `table` / `filter` skip predicates remain the finer per-bridge control).

### Patch Changes

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
