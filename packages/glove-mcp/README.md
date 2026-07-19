# glove-mcp

Model Context Protocol integration for the [Glove](https://github.com/porkytheblack/glove) agent framework. Bridge any MCP server's tools into a Glove agent and let the model discover and activate them on demand.

## Install

```sh
pnpm add glove-mcp
```

Requires `glove-core` as a peer; HTTP transport only in v1.

## Minimal usage

Wire a static catalogue of MCP servers into a `Glove` instance via `mountMcp`. The auth seam is `McpAdapter.getAccessToken(id) -> string` — return a bearer token, however you obtained it. For servers that don't take a bearer token, implement `getAuthHeaders(id) -> Record<string, string>` instead (see [Auth model](#auth-model)).

```ts
import { Glove } from "glove-core/glove";
import { mountMcp } from "glove-mcp";
import type { McpAdapter, McpCatalogueEntry } from "glove-mcp";

const ENTRIES: McpCatalogueEntry[] = [
  {
    id: "notion",
    name: "Notion",
    description: "Search, read, and edit pages in a Notion workspace.",
    url: "https://mcp.notion.com/mcp",
    tags: ["docs", "notes", "wiki"],
  },
];

class MyAdapter implements McpAdapter {
  identifier: string;
  private active = new Set<string>();
  constructor(id: string) { this.identifier = id; }

  async getActive() { return [...this.active]; }
  async activate(id: string) { this.active.add(id); }
  async deactivate(id: string) { this.active.delete(id); }

  async getAccessToken(id: string) {
    // Return a bearer string from wherever you persisted it.
    return process.env[`${id.toUpperCase()}_TOKEN`]!;
  }
}

const glove = new Glove({ /* model, store, displayManager, ... */ });
const runnable = glove.build();

await mountMcp(runnable, {
  adapter: new MyAdapter(sessionId),
  entries: ENTRIES,
  clientInfo: { name: "my-app", version: "1.0.0" },
});
```

`mountMcp` reloads any servers the adapter reports as already active (so an existing conversation rehydrates its tools on session boot) and folds in `discovermcp` — a discovery subagent the model uses to activate new MCPs from the catalogue mid-conversation.

## Excluding tools

A server often exposes tools you don't want the model to have — dangerous writes, noisy duplicates, things your app handles itself. Drop them per-server with `excludeTools` on the catalogue entry (exact, **un-namespaced** names — as the server knows them):

```ts
const ENTRIES: McpCatalogueEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Issues, PRs, repos.",
    url: "https://mcp.github.com/mcp",
    excludeTools: ["delete_repository", "transfer_repository"], // never mounted
  },
];
```

Exclusion is applied at the **connection**, so it bubbles through every mount path from one place — the boot-time reload, the `discovermcp` subagent's `activate`, and any `glove-scratchpad` bridge (`mcpResources` / `fnsFromMcp`) built from the same connection all bridge exactly the filtered listing. An excluded tool never reaches the model, whichever surface it would have arrived on.

For catalogue-wide rules, pass `filterTools` to `mountMcp` — it runs on top of each entry's `excludeTools`:

```ts
await mountMcp(runnable, {
  adapter,
  entries: ENTRIES,
  // Drop every tool the server annotates as destructive, across all servers.
  filterTools: (tool, entry) => !tool.annotations?.destructiveHint,
});
```

Connecting directly (e.g. to feed a `glove-scratchpad` surface)? Set the same options on `connectMcp` and they apply to that connection's whole listing:

```ts
const conn = await connectMcp({
  namespace: "github",
  url: "https://mcp.github.com/mcp",
  excludeTools: ["delete_repository"],
  filterTools: (t) => !t.annotations?.destructiveHint,
});
// mcpResources(conn) / fnsFromMcp(conn) never see the excluded tools.
```

Only the listing is filtered — `conn.raw` and a direct `conn.callTool(name, …)` are left untouched as an advanced escape hatch.

## Auth model

Two optional seams on the adapter. The common case is `getAccessToken` — the framework wraps the returned string in `Authorization: Bearer ...` and never touches refresh logic. When a server wants something other than a bearer token (e.g. Composio's `x-api-key`), implement `getAuthHeaders` and return the full header map yourself; it takes precedence over `getAccessToken` when both are defined. With neither, connections are made without auth headers.

```ts
interface McpAdapter {
  identifier: string;
  getActive(): Promise<string[]>;
  activate(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;
  getAccessToken?(id: string): Promise<string>;
  getAuthHeaders?(id: string): Promise<Record<string, string>>;
}
```

```ts
class ComposioAdapter implements McpAdapter {
  // ...getActive / activate / deactivate...
  async getAuthHeaders(id: string) {
    return { "x-api-key": process.env.COMPOSIO_API_KEY! };
  }
}
```

Both seams are called every time a connection is established (session boot + each fresh activation). Throwing causes the activation to fail gracefully — the model sees an error, the conversation continues.

For direct `connectMcp` calls, the matching helpers are `bearer(tokenOrThunk)` and `headers(mapOrThunk)`:

```ts
import { connectMcp, headers } from "glove-mcp";

const conn = await connectMcp({
  namespace: "composio",
  url: "https://mcp.composio.dev/...",
  auth: headers({ "x-api-key": process.env.COMPOSIO_API_KEY! }),
});
```

When a token expires mid-call, the bridged tool returns:

```ts
{ status: "error", message: "auth_expired", data: null }
```

That's the contract. Watch for it in your subscriber / UI, refresh the token in your store, and the next connection picks up the new value. Token lifecycle (acquisition, refresh, persistence) is entirely the consumer's responsibility — `glove-mcp` only reads.

## OAuth (opt-in via `glove-mcp/oauth`)

Consumers with static tokens (personal API keys, service accounts) skip this entirely. For the MCP authorization spec OAuth flow against hosted servers (Notion, Linear, Gmail, ...), the `glove-mcp/oauth` subpath ships a runner and two reference stores:

```ts
import { FsOAuthStore, runMcpOAuth } from "glove-mcp/oauth";

await runMcpOAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "notion",
});
```

The runner:

1. Spins up a local HTTP listener on `localhost:53683/callback`.
2. Drives the SDK's `auth()` — Dynamic Client Registration + PKCE.
3. Opens the user's browser; waits for them to grant access.
4. Exchanges the code for tokens; persists them via the store.
5. Optionally verifies by listing tools.

For servers without DCR (e.g. Google's hosted MCP), pass `preRegisteredClient: { client_id, client_secret }` and a `scope`.

`FsOAuthStore` writes a single 0600 JSON file — fine for CLIs and local dev. `MemoryOAuthStore` for tests. In production, implement `OAuthStore` against your own DB; the interface is three methods (`get`, `set`, `delete`).

The adapter's `getAccessToken` then just reads from your store:

```ts
async getAccessToken(id: string) {
  const state = await STORE.get(id);
  if (state.tokens?.access_token) return state.tokens.access_token;
  throw new Error(`No token for "${id}". Run \`my-app auth ${id}\`.`);
}
```

## Discovery

`mountMcp` always folds `discovermcp` — a subagent tool the model invokes when it suspects a useful MCP is sitting in the catalogue but isn't yet active. The subagent matches the user's request against entries' `name` / `description` / `tags`, calls `activate(id)` on the adapter, connects, and folds the bridged tools into the running Glove.

Three ambiguity policies via `MountMcpConfig.ambiguityPolicy` — pass as `{ type: "<policy>" }`:

| Policy | Behavior |
|--------|----------|
| `{ type: "interactive" }` | Subagent calls `pushAndWait` with an `mcp_picker` slot. Requires a renderer in your displayManager. Default for interactive Gloves. |
| `{ type: "auto-pick-best" }` | Subagent silently picks the highest-ranked match. No human in the loop. Default when `glove.serverMode === true`. |
| `{ type: "defer-to-main" }` | Subagent returns the candidate list as text and lets the main agent decide. |

Override the subagent's model or system prompt via `subagentModel` / `subagentSystemPrompt` if needed.

### Tool namespacing

Bridged tools are exposed to the model as `${entry.id}__${tool.name}` — a Notion `search` tool surfaces as `notion__search`. The `__` separator is regex-safe across all model providers.

### Server mode

`new Glove({ serverMode: true, ... })` flips two defaults relevant to MCP:

- Bridged tools default to `requiresPermission: false` (no human-in-the-loop gating). Tools annotated `readOnlyHint: true` are also unguarded; everything else still gates in interactive mode.
- Discovery defaults to `auto-pick-best`.

Use it for headless agents — cron jobs, server-side automation, evals.

## Production lift-and-shift

The reference CLIs in `examples/mcp-cli/` are a single-user shape: `FsOAuthStore`, one bearer token, the OAuth dance run from a terminal. For a multi-user app, swap `FsOAuthStore` for a per-user `OAuthStore` against your DB, move the OAuth flow from a CLI into route handlers (`GET /oauth/<id>/start` calls `runMcpOAuth`, `GET /oauth/<id>/callback` finishes it), and refresh expired tokens however your stack does it. The agent code doesn't change — `McpAdapter.getAccessToken` is the only seam.

## Key exports

- **`mountMcp(runnable, config)`** — the canonical wiring point. Reloads active servers and folds `discovermcp`.
- **`McpAdapter`** — the per-conversation interface consumers implement.
- **`McpCatalogueEntry`** — static description of an MCP server the app supports (incl. per-server `excludeTools`).
- **`connectMcp`** / **`bridgeMcpTool`** — lower-level building blocks if you need to bypass `mountMcp`. `connectMcp` takes `excludeTools` / `filterTools`.
- **`includeTool(tool, { excludeTools, filterTools })`** — the pure drop predicate `connectMcp` applies; exported for reuse/testing.
- **`bearer(getter)`** — helper that wraps a token (or `() => Promise<string>` getter) into a `ConnectMcpAuth` emitting `Authorization: Bearer ...`.
- **`headers(mapOrGetter)`** — helper that wraps a header map (or getter) into a `ConnectMcpAuth`, for non-bearer servers (e.g. `x-api-key`).
- **`adapterAuth(adapter, id)`** — resolves an entry's `ConnectMcpAuth` from the adapter's seams (`getAuthHeaders` first, then `getAccessToken`).
- **`MCP_NAMESPACE_SEP`** — the `__` separator constant.

From `glove-mcp/oauth`:

- **`runMcpOAuth(opts)`** — end-to-end MCP-spec OAuth flow.
- **`FsOAuthStore`** / **`MemoryOAuthStore`** — reference `OAuthStore` impls.
- **`McpOAuthProvider`** / **`buildClientMetadata`** — lower-level pieces if you want to drive the SDK's `auth()` yourself.

## Examples

Full reference consumer code lives in [`examples/mcp-cli/`](../../examples/mcp-cli/) — a multi-MCP CLI with `discovermcp` discovery, plus focused single-server agents for Notion and Gmail. Each `*-mcp-auth.ts` is ~50 lines on top of `runMcpOAuth`.

## Documentation

- [MCP Integration Guide](https://glove.dterminal.net/docs/mcp)
- [Getting Started](https://glove.dterminal.net/docs/getting-started)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
