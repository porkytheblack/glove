# glove-mcp examples

Two server-side CLIs that exercise `glove-mcp`:

| Script              | File               | What it shows |
|---------------------|--------------------|---------------|
| `pnpm mcp:cli`      | `index.ts`         | Multi-MCP agent with `find_capability` discovery (Notion + Linear in the catalogue, `defer-to-main` ambiguity policy). |
| `pnpm mcp:notion`   | `notion-agent.ts`  | Focused Notion agent — Notion is pre-activated at startup; no discovery needed. Useful as a smoke test for your token. |

Both run headlessly (`serverMode: true`) with an in-memory `McpAdapter` and resolve tokens from environment variables.

---

## Quick start

```sh
cp examples/mcp-cli/.env.example examples/mcp-cli/.env
# fill in ANTHROPIC_API_KEY and NOTION_TOKEN
pnpm install

# focused Notion agent (recommended for first run)
pnpm mcp:notion

# multi-MCP discovery agent
pnpm mcp:cli
```

The Notion agent runs a preflight `listTools` call before dropping into the REPL, so you get a clear connection error if your token is wrong instead of a silent failure mid-conversation.

---

## Notion auth setup

Notion exposes MCP through two paths, each with a different auth model. Pick whichever matches your situation.

### Option 1 — Self-hosted with an internal integration token (recommended for local dev)

This is the simplest setup: you create an internal integration in Notion, share the pages you want the agent to touch, and run the official `@notionhq/notion-mcp-server` package locally. Because that package speaks stdio (not HTTP) and `glove-mcp` v1 only speaks HTTP, you put a tiny stdio→HTTP shim in front of it. `mcp-proxy` works out of the box.

1. Go to <https://www.notion.so/profile/integrations>.
2. Click **New integration**, choose **Internal**, give it a name, and pick the workspace.
3. On the integration's page, copy the **Internal Integration Secret**. It starts with `ntn_` (newer) or `secret_` (older).
4. In Notion, open every page or database you want the agent to access. Click the `•••` menu → **Connections** → search for your integration and connect it. The agent can only see pages explicitly shared with it.
5. Run the MCP server behind an HTTP proxy:

   ```sh
   # in a separate terminal
   NOTION_TOKEN=ntn_your_token_here \
   npx -y mcp-proxy --port 3030 -- npx -y @notionhq/notion-mcp-server
   ```

6. In `examples/mcp-cli/.env`:

   ```env
   NOTION_TOKEN=ntn_your_token_here
   NOTION_MCP_URL=http://localhost:3030/mcp
   ```

7. `pnpm mcp:notion` — the preflight should print "Connected. N Notion tools available: …".

> The `Authorization: Bearer <NOTION_TOKEN>` header that `glove-mcp` sends is forwarded verbatim by `mcp-proxy` to the upstream stdio process. `notion-mcp-server` reads `NOTION_TOKEN` from its own environment, so you'll typically see the same token referenced in two places: as the proxy's `NOTION_TOKEN` env var (so it has it on startup) and in glove-mcp's `.env` (so the bridge can re-resolve it on each connection).

### Option 2 — Hosted Notion MCP via OAuth (recommended for production / multi-user apps)

Notion's hosted server at `https://mcp.notion.com/mcp` requires an **OAuth access token** issued by the standard Notion OAuth flow — not an internal integration token.

1. <https://www.notion.so/profile/integrations> → **New integration** → **Public**.
2. Configure the integration's redirect URI (the URL you'll redirect users to after they authorize), capabilities, etc., per Notion's docs: <https://developers.notion.com/docs/authorization>.
3. Run the OAuth authorization-code flow in your app to obtain an access token for the user.
4. Have your `McpAdapter.getAccessToken("notion")` return that user's stored access token (not the integration's client secret). For the CLI in this folder, that means putting a single user's access token into `NOTION_TOKEN`.
5. Leave `NOTION_MCP_URL` unset (defaults to `https://mcp.notion.com/mcp`).

In real apps the OAuth flow lives in your backend — `glove-mcp` deliberately has no OAuth machinery. `McpAdapter.getAccessToken(id)` is the single seam where you hand a fresh token over per connection. If a token expires mid-call, the bridged tool returns `{ status: "error", message: "auth_expired" }` so your app can refresh and reactivate.

---

## What "active" means

The `McpAdapter.getActive()` list is the set of MCP servers active in *this conversation*. `mountMcp` reads it on session boot and reloads each one (connect → listTools → fold). The discovery subagent calls `adapter.activate(id)` after a successful connect, so the next session re-attaches automatically.

In `notion-agent.ts` we call `adapter.activate("notion")` ourselves before `mountMcp` to skip the discovery step entirely — Notion shows up as already-active, gets reloaded, and the model has `notion__*` tools on its very first turn.

---

## Linear (used by the multi-MCP CLI)

Linear's hosted MCP at `https://mcp.linear.app/mcp` works the same way — create an OAuth app under Linear's API settings, run an authorization-code flow, store the access token, return it from `getAccessToken("linear")`. Quick path for a personal CLI: use a personal API key from <https://linear.app/settings/api> as the bearer token; Linear's MCP server accepts those.

```env
LINEAR_TOKEN=lin_api_...
```

---

## Troubleshooting

- **`Failed to connect to Notion MCP. Unauthorized`** — your `NOTION_TOKEN` is wrong or stale. For Option 1, double-check it's the integration secret (not the integration ID). For Option 2, the token has likely expired — refresh via OAuth.
- **`tools` array is empty after preflight** — for Option 1, you haven't shared any pages with the integration yet. Open a Notion page → `•••` → **Connections** → connect your integration.
- **`auth_expired` returned mid-conversation** — token went stale during the session. The CLI surfaces this in a `[tool error: auth_expired]` line. Restart with a fresh token; in your real app, refresh and re-activate.
- **Tool name confusion** — bridged tools are namespaced. A Notion `search` tool shows up to the model as `notion__search`. The `__` separator is regex-safe across all model providers.
