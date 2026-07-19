---
"glove-mcp": minor
"glove-scratchpad": patch
---

Exclude tools from an MCP server — one knob that bubbles through every mount path.

A server often exposes tools you don't want the model to reach (dangerous writes, noisy duplicates, capabilities your app handles itself). There was no way to drop them from the main `mountMcp` path.

- **`McpCatalogueEntry.excludeTools?: string[]`** — per-server exclusion by exact, un-namespaced tool name.
- **`connectMcp`** gains `excludeTools?: string[]` and `filterTools?: (tool) => boolean`. The filter runs inside `listTools()`, so excluded tools are dropped at the connection — which means they never reach ANY consumer: the boot-time reload, the `discovermcp` subagent's `activate`, and any `glove-scratchpad` bridge (`mcpResources` / `fnsFromMcp`) built over the same connection all bridge exactly the filtered listing.
- **`mountMcp`** (and the discovery subagent) gain `filterTools?: (tool, entry) => boolean` for catalogue-wide rules, applied on top of each entry's `excludeTools` — e.g. drop every destructive tool across all servers.
- **`includeTool(tool, { excludeTools, filterTools })`** — the exported pure drop predicate `connectMcp` applies.

Only the tool *listing* is filtered; `conn.raw` and a direct `conn.callTool(name, …)` are left untouched as an advanced escape hatch.

`glove-scratchpad`: no API change — the `mcpResources` / `fnsFromMcp` bridges already read `conn.listTools()`, so they inherit connection-level exclusion for free. Docs clarify that setting `excludeTools` on `connectMcp` is how you keep tools off the scratchpad surfaces (the existing `table` / `filter` skip predicates remain the finer per-bridge control).
