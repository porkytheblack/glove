# MCP servers (glove-mcp)

> Read when bridging Model Context Protocol servers into an agent: `mountMcp`, catalogue entries, the per-conversation `McpAdapter`, discovery, auth headers, `auth_expired` and OAuth helpers.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## MCP Integration (`glove-mcp`)

`glove-mcp` bridges Model Context Protocol servers (Notion, Gmail, Linear, Slack, an internal MCP wrapper around your own APIs, …) into a Glove agent so their tools appear in the model's tool list as ordinary Glove tools. Streamable HTTP transport only in v1.

### When to use it

- You need third-party capabilities a vendor already exposes via MCP — Notion, Gmail, Linear, Slack, Zapier-MCP, etc.
- You have multiple internal services and want a single integration shape across them.
- You want the agent to discover and activate capabilities mid-conversation rather than wiring all tools at startup.

If you control both ends and just need a few first-party tools, hand-rolled `glove.fold(...)` is still simpler. MCP earns its keep when the catalogue is large or the servers are not yours.

### Mental model: catalogue + adapter

Two pieces, deliberately split:

- **`McpCatalogueEntry[]`** — a static list authored at the application level. One entry per MCP server the app supports: `id`, `name`, `description`, `url`, `tags?`, `excludeTools?`, `metadata?`. Identical across users. The `id` doubles as the tool namespace prefix and the activation key. `excludeTools?: string[]` drops tools by exact un-namespaced name — filtered at the connection, so an excluded tool is never mounted by ANY path (boot reload, `discovermcp` activate, or a `glove-scratchpad` bridge over the same connection).

- **`McpAdapter`** — a per-conversation interface the consumer implements (analogous to `StoreAdapter`). Holds the conversation's active server ids and resolves access tokens.

  ```typescript
  interface McpAdapter {
    identifier: string;                          // for log correlation
    getActive(): Promise<string[]>;              // ids active in this conversation
    activate(id: string): Promise<void>;         // called by the discovery subagent
    deactivate(id: string): Promise<void>;       // for the consumer's UI; v1 limitation: doesn't unload tools
    getAccessToken?(id: string): Promise<string>;                // bearer seam — return a token string
    getAuthHeaders?(id: string): Promise<Record<string, string>>; // custom-header seam — e.g. { "x-api-key": ... }; wins over getAccessToken
  }
  ```

`getAccessToken` / `getAuthHeaders` are the only auth seams. The common case is `getAccessToken` — the framework wraps the returned string in `Authorization: Bearer ...`. For servers that don't take a bearer token (e.g. Composio's `x-api-key`), implement `getAuthHeaders` and return the full header map; it takes precedence when both are defined, and with neither, connections are made without auth headers. Credential acquisition, refresh, and persistence are entirely the consumer's responsibility — env vars, vault, your own OAuth flow, the opt-in `runMcpOAuth` helper, all valid.

### `mountMcp` — the canonical entry point

After `new Glove(...)` and before `glove.build()`:

```typescript
import { mountMcp } from "glove-mcp";

const glove = new Glove({ /* ... */ , serverMode: true });

await mountMcp(glove, {
  adapter,                                  // McpAdapter
  entries,                                  // McpCatalogueEntry[]
  ambiguityPolicy: { type: "auto-pick-best" },  // optional
  subagentModel: undefined,                 // optional — defaults to glove.model
  subagentSystemPrompt: undefined,          // optional — defaults to per-policy prompt
  clientInfo: { name: "My App", version: "1.0.0" },  // optional
  filterTools: (tool, entry) => !tool.annotations?.destructiveHint,  // optional — catalogue-wide drop
});

glove.build();
```

What it does, in order:

1. Reads `adapter.getActive()`, opens an MCP connection per active id (using `getAccessToken`), lists tools, and folds each one onto the main agent via `bridgeMcpTool`. Per-server reload failures are logged and skipped — a transient outage doesn't kill the agent.
2. Registers the `discovermcp` discovery **subagent** via `glove.defineSubAgent(discoverySubAgent({...}))` so the model can ask it to activate more servers mid-conversation. The model invokes it via `glove_invoke_subagent({ name: "discovermcp", prompt: "..." })`.

**Excluding tools.** To keep specific tools off the model, set `excludeTools: string[]` (exact un-namespaced names) on the `McpCatalogueEntry`, or pass `filterTools: (tool, entry) => boolean` to `mountMcp` for a catalogue-wide rule (runs on top of each entry's `excludeTools`). Both are applied at the **connection** (`connectMcp` also accepts `excludeTools` / `filterTools` directly), so the exclusion bubbles through every mount path from one place — boot reload, `discovermcp` activate, and any `glove-scratchpad` bridge (`mcpResources` / `fnsFromMcp`) built over the same connection. Only the listing is filtered; `conn.raw` / `conn.callTool` stay untouched. `includeTool(tool, { excludeTools, filterTools })` is the exported pure predicate.

`mountMcp` returns when reload + subagent registration are complete. Call it before `build()` for the cleanest init order, but `fold()` / `defineSubAgent()` after `build()` work too.

### Bridged tool shape

`bridgeMcpTool(connection, tool, serverMode)` produces a `GloveFoldArgs` with these conventions:

- **Name**: `${entry.id}__${tool.name}` (e.g. `notion__search`). The `__` separator (exported as `MCP_NAMESPACE_SEP`) is regex-safe across all model providers.
- **Input schema**: raw JSON Schema from the MCP server, passed via `jsonSchema` (no Zod). The MCP server is the source of truth.
- **Result shape**: when the server declares an `outputSchema` (MCP 2025-06-18+), a compact `Returns: …` shape (via `jsonSchemaToShape`, exported) is appended to the tool description — model tool-call wire formats are input-only, so the description is the only channel to surface the return shape on the plain bridged path. Servers below that revision, or without a declared schema, omit it.
- **`requiresPermission`**: in `serverMode` always `false`; otherwise `true` unless the MCP tool annotates `readOnlyHint: true`.
- **Result**: the model sees the server's `structuredContent` when present (MCP 2025-06-18+, JSON-stringified into `data`), else the joined `content[]` text; the full `content[]` is always passed through as `renderData` so React renderers can use it.
- **Auth-expired contract**: any 401-shaped error during `callTool` is mapped to `{ status: "error", message: "auth_expired", data: null }`. Detect this from the conversation log, refresh your token, and the next call picks up the new value via `getAccessToken`.

### Discovery (`discovermcp`) and ambiguity policies

`mountMcp` registers a single subagent the model can route to: **`discovermcp`**. The model invokes it via `glove_invoke_subagent({ name: "discovermcp", prompt: "send an email" })`. The factory builds a child `Glove` (with its own sub-store from `parentStore.createSubAgentStore("discovermcp", false)`, falling back to a private `DiscoveryMemoryStore` when sub-stores aren't supported, inheriting the main agent's model, displayManager, and `serverMode`), and folds these tools onto the child:

- `list_capabilities(query?, tags?)` — substring search the catalogue.
- `activate(id)` — connect, bridge tools onto the *main* agent, persist active state. Tools become available to the main model on its next turn.
- `deactivate(id)` — flip persisted state. v1 limitation: tools stay loaded until session refresh.
- `ask_user(question, options)` — only registered under the `interactive` policy. Renders via the `mcp_picker` renderer on the main displayManager.

The **ambiguity policy** controls what happens when the subagent finds multiple plausible matches:

| Policy | Behavior | When to use |
|--------|----------|-------------|
| `{ type: "interactive" }` | Subagent calls `ask_user` via `pushAndWait`. Requires an `mcp_picker` renderer on your displayManager. | Browser UIs / chat apps with a renderer wired up. Default when `serverMode: false`. |
| `{ type: "auto-pick-best" }` | Subagent always picks the highest-ranked match. No human in the loop. | Headless / server-side / CLI. Default when `serverMode: true`. |
| `{ type: "defer-to-main" }` | Subagent returns the candidate list as text and lets the main agent decide what to activate. | Multi-MCP discovery flows where the main model has more conversation context than the subagent. |

`serverMode: true` on the `Glove` config is the canonical "I am headless" flag — drives both the default ambiguity policy and the default `requiresPermission` on bridged tools (never gate).

### Auth model — static headers (bearer or custom)

The framework only knows about static headers per connection. `connectMcp` ships two helpers: `auth: bearer(token | () => token)` for `Authorization: Bearer ...`, and `auth: headers(map | () => map)` for servers that want custom headers (e.g. Composio's `x-api-key`). Both accept a thunk that re-resolves per connection. `mountMcp` and the discovery `activate` tool resolve auth via `adapterAuth(adapter, id)` — `getAuthHeaders` when defined, else `getAccessToken` wrapped as a bearer, else no auth headers.

```typescript
import { bearer, headers, connectMcp } from "glove-mcp";

const conn = await connectMcp({
  namespace: "notion",
  url: "https://mcp.notion.com/mcp",
  auth: bearer(() => adapter.getAccessToken!("notion")),
  clientInfo: { name: "My App", version: "1.0.0" },
});

const composio = await connectMcp({
  namespace: "composio",
  url: "https://mcp.composio.dev/...",
  auth: headers({ "x-api-key": process.env.COMPOSIO_API_KEY! }),
});
```

### `auth_expired` contract

Mid-call, an expired token surfaces as `{ status: "error", message: "auth_expired" }` on the bridged tool result. The framework does **not** refresh tokens. Your app must:

1. Detect `auth_expired` on the conversation log (subscriber `tool_use_result` event, or post-hoc).
2. Refresh / re-auth via whatever mechanism owns the credential.
3. Update your store; the next bridged call pulls a fresh token from `getAccessToken`.

For UI consumers this is usually a "Reconnect Notion" toast. For CLIs, instructing the user to re-run the auth command is normal.

### `glove-mcp/oauth` — opt-in OAuth tooling

If you don't already have an OAuth flow, the `glove-mcp/oauth` subpath ships a small reference implementation built on the MCP authorization spec:

- **`runMcpOAuth(opts)`** — one call, end-to-end flow. Spins up a local listener on `http://localhost:53683/callback` (configurable), drives the SDK through DCR (or skips it via `preRegisteredClient`), opens the user's browser, exchanges the code for tokens, and verifies via `listTools` (or a `callTool` of your choice). Used by the `examples/mcp-cli/*-mcp-auth.ts` scripts.
- **`FsOAuthStore` / `MemoryOAuthStore`** — `OAuthStore` implementations. `FsOAuthStore` writes a single JSON file with mode `0600` and atomic temp+rename. Replace with your DB for production.
- **`McpOAuthProvider`** — lower-level `OAuthClientProvider` for advanced consumers driving `auth()` from the SDK directly.
- **`buildClientMetadata`**, **`MCP_DEFAULT_CLIENT_INFO`**, **`emptyOAuthState`** — small helpers.

Consumers who already have tokens (env vars, internal integrations, vault, an existing OAuth setup) can ignore this subpath entirely — `getAccessToken` returns the bearer, full stop.

See [api-reference.md — `glove-mcp/oauth`](api-reference.md) for full type signatures, and [examples.md — Pattern: MCP OAuth flow](examples.md) for a worked example.

### Production lift-and-shift

The reference `examples/mcp-cli` setup is a single-user Node CLI; production typically wants:

- **Multi-user store** — replace `FsOAuthStore` with a per-user `OAuthStore` backed by your DB. The interface is three methods (`get`, `set`, `delete`).
- **OAuth flow in route handlers** — `GET /oauth/<id>/start` calls `runMcpOAuth` (or the lower-level SDK `auth()` directly), `GET /oauth/<id>/callback` finishes it. Same machinery, different invocation. The local-listener flavour of `runMcpOAuth` is convenient for CLIs but not what you want behind a load balancer.
- **Background refresh** — refresh expired tokens however your stack does it; `getAccessToken` just reads the latest bearer string.
- **Persistent active state** — the `McpAdapter` shown in examples uses an in-memory `Set` for active ids. In production, persist active ids per conversation (alongside messages) so reload after restart actually does something.

The agent code itself doesn't change — `McpAdapter.getAccessToken` is the only seam.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Mount MCP onto an agent | `mountMcp(glove, { adapter, entries, ... })` |
| Implement consumer adapter | `McpAdapter` interface |
| Author catalogue entries | `McpCatalogueEntry` |
| One-off connect (preflight, custom flow) | `connectMcp({ namespace, url, auth })` |
| Bridge a tool by hand | `bridgeMcpTool(connection, tool, serverMode)` |
| Bearer header helper | `bearer(token | () => token)` |
| Custom headers helper (non-bearer, e.g. `x-api-key`) | `headers(map | () => map)` |
| Adapter → auth resolver | `adapterAuth(adapter, id)` |
| Discovery subagent factory | `discoverySubAgent({ adapter, entries, ambiguityPolicy })` (returns `DefineSubAgentArgs`; pass to `glove.defineSubAgent(...)`) |
| Tool namespace separator | `MCP_NAMESPACE_SEP` (`"__"`) |
| 401 detection on raw connect | `UnauthorizedError` |
| Run the OAuth flow | `runMcpOAuth(opts)` from `glove-mcp/oauth` |
| Persist OAuth state | `FsOAuthStore`, `MemoryOAuthStore` from `glove-mcp/oauth` |
| Build client metadata | `buildClientMetadata(opts)` from `glove-mcp/oauth` |
