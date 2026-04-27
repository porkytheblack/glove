# glove-mcp examples

Three server-side CLIs that exercise `glove-mcp`:

| Command                  | File              | What it does |
|--------------------------|-------------------|--------------|
| `pnpm mcp:notion-auth`   | `notion-auth.ts`  | Runs the full Notion OAuth 2.0 authorization-code flow — spins up a local callback listener, opens your browser, exchanges the code for an access token, persists it to `.notion-token.json`. |
| `pnpm mcp:notion`        | `notion-agent.ts` | Focused Notion agent — reads the stored token and pre-activates Notion at startup. |
| `pnpm mcp:cli`           | `index.ts`        | Multi-MCP agent with `find_capability` discovery (Notion + Linear catalogue). |

`glove-mcp` itself ships no OAuth machinery — `McpAdapter.getAccessToken(id)` is the seam where consumers plug in. `notion-auth.ts` is a complete reference consumer: it owns the OAuth flow, persists the result, and the agents read from the persisted store via the adapter. You can lift this file straight into a real product and swap `FsTokenStore` for whatever your backend uses (Postgres, Vault, Redis, …).

---

## End-to-end setup

### 1. Create a Public integration in Notion

1. Open <https://www.notion.so/profile/integrations>.
2. Click **New integration** → **Public**. (Public is required for OAuth; Internal integrations use a static token instead and skip this whole flow.)
3. On the integration's settings page:
    - Set **Redirect URIs** to `http://localhost:53682/callback`. The auth CLI listens on this exact URL by default — you can pick a different port via `NOTION_OAUTH_PORT`, but whatever you pick must match what's configured here.
    - Set the **Capabilities** you want the agent to have (read content, update content, insert content, comments).
    - Save.
4. Under **Secrets**, copy the **OAuth client ID** and the **OAuth client secret**.

### 2. Drop the credentials into `.env`

```sh
cp examples/mcp-cli/.env.example examples/mcp-cli/.env
```

Edit `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
NOTION_OAUTH_CLIENT_ID=12345678-1234-1234-1234-123456789012
NOTION_OAUTH_CLIENT_SECRET=secret_...
```

### 3. Run the auth flow

```sh
pnpm install
pnpm mcp:notion-auth
```

You'll see something like:

```
Notion OAuth setup
==================

  Client ID:    12345678-1234-1234-1234-123456789012
  Redirect URI: http://localhost:53682/callback
  Listening on: http://127.0.0.1:53682

Opening Notion authorization page in your browser...
Waiting for you to grant access...
```

Your browser opens Notion's authorization page. Pick the workspace and the pages you want to share with the integration, click **Allow**, and Notion redirects to your local callback. The CLI exchanges the code, prints a confirmation, and writes the token to `examples/mcp-cli/.notion-token.json` (mode `0600`, gitignored).

```
✓ Notion access granted and token saved.

  Workspace:  My Awesome Workspace  [aaaa-bbbb-...]
  Bot:        cccc-dddd-...
  Saved to:   examples/mcp-cli/.notion-token.json
```

### 4. Run the agent

```sh
pnpm mcp:notion
```

The agent reads the token from `.notion-token.json` via `FsTokenStore`, runs a preflight `listTools` call so a stale token fails loudly before the REPL starts, and drops you into chat with `notion__*` tools available on turn one.

```
Connecting to Notion MCP at https://mcp.notion.com/mcp...
Connected to workspace "My Awesome Workspace". 14 Notion tools available: notion__search, notion__fetch, ...
Notion agent ready. Type your message, or '/exit' to quit.
> Find me the roadmap doc and add a bullet under "Q3" saying "Ship MCP integration"
```

---

## How the flow fits together

```
   ┌──────────────────┐   OAuth code/state    ┌────────────────┐
   │ pnpm mcp:notion- │ ────────────────────► │  Notion OAuth  │
   │      auth        │ ◄──────── token ───── │    server      │
   └────────┬─────────┘                       └────────────────┘
            │  writes
            ▼
   ┌──────────────────┐
   │ .notion-token.   │   ← FsTokenStore (atomic write, mode 0600)
   │      json        │
   └────────┬─────────┘
            │  reads
            ▼
   ┌──────────────────────────────────────────────────────┐
   │ McpAdapter.getAccessToken("notion")                  │
   │   1. process.env.NOTION_TOKEN  (if set, used as-is)  │
   │   2. tokenStore.get("notion")  (OAuth path)          │
   └────────┬─────────────────────────────────────────────┘
            │  resolves a fresh token on every connection
            ▼
   ┌──────────────────┐
   │ glove-mcp        │   `Authorization: Bearer <token>`
   │ connectMcp(...)  │ ─────────────► https://mcp.notion.com/mcp
   └──────────────────┘
```

Three things to notice:

1. **Token resolution happens per-connection, not at process start.** `getAccessToken` is called inside `connectMcp` every time, so when you eventually add token refresh you can just update the stored token and the next connection will pick it up automatically.
2. **Env var beats stored token.** Useful when you already have an internal integration token (`ntn_…`) and want to bypass OAuth, or for CI runs.
3. **`auth_expired` is the contract.** If a token expires mid-session, the bridged tool returns `{ status: "error", message: "auth_expired" }`. The agent's subscriber can react by surfacing a "reconnect" prompt, the consumer can refresh and reactivate, etc. Check `notion-agent.ts` for a minimal example that prints these errors as `[tool error: auth_expired]`.

---

## Production lift-and-shift

Everything outside `lib/token-store.ts` is reusable. To go to production:

- Replace `FsTokenStore` with a per-user store backed by your database. The interface is two methods (`get(id)`, `set(id, token)`).
- Move `notion-auth.ts` from a CLI into a route handler:
    - `GET /oauth/notion/start` builds the authorize URL and 302s the user to Notion.
    - `GET /oauth/notion/callback` does what the local callback listener does today: validates `state`, exchanges the code, persists the token (keyed by your user id, not by `"notion"`).
- The agent code stays identical — only the `McpAdapter` implementation changes.

---

## Alternative: skip OAuth, use an internal integration token

If you don't need multi-user OAuth (e.g. solo dev, CI agent, internal tooling):

1. Create an **Internal** integration at <https://www.notion.so/profile/integrations>.
2. Copy the **Internal Integration Secret** (`ntn_…` or `secret_…`).
3. Share each page/database you want the agent to touch with that integration (page menu → **Connections**).
4. Notion's hosted MCP at `mcp.notion.com/mcp` only accepts OAuth tokens, so for internal tokens you run Notion's official `@notionhq/notion-mcp-server` package locally. It speaks stdio, so front it with a stdio→HTTP shim:
    ```sh
    NOTION_TOKEN=ntn_… npx -y mcp-proxy --port 3030 -- npx -y @notionhq/notion-mcp-server
    ```
5. In `.env`:
    ```env
    NOTION_TOKEN=ntn_…
    NOTION_MCP_URL=http://localhost:3030/mcp
    ```
6. Skip `pnpm mcp:notion-auth`. The agent's `getAccessToken` sees `NOTION_TOKEN` set in env and uses that path directly.

---

## Troubleshooting

- **`Authorization failed: redirect_uri_mismatch`** — the redirect URI in your Notion integration settings must exactly match the `Redirect URI` printed by the auth CLI. Same scheme, host, port, path.
- **`Notion token exchange failed (401): invalid_client`** — `NOTION_OAUTH_CLIENT_ID` or `NOTION_OAUTH_CLIENT_SECRET` is wrong or copy-pasted with whitespace.
- **`No access token for "notion"`** — you haven't run `pnpm mcp:notion-auth` yet, or the token file got deleted. Run it again.
- **Empty tool list** — for the internal-integration path, you haven't shared any pages with the integration yet. For OAuth, your authorized scopes don't grant any capability — re-run the auth flow and grant pages on the consent screen.
- **`auth_expired` mid-conversation** — the access token is no longer valid. Re-run `pnpm mcp:notion-auth` and restart the agent.
- **Tool name confusion** — bridged tools are namespaced. A Notion `search` tool shows up to the model as `notion__search`. The `__` separator is regex-safe across all model providers.

---

## Linear (used by the multi-MCP CLI)

Linear's hosted MCP at `https://mcp.linear.app/mcp` works the same way. Quick path for a personal CLI: use a personal API key from <https://linear.app/settings/api> as the bearer token; Linear's MCP server accepts those.

```env
LINEAR_TOKEN=lin_api_...
```

For multi-user setups, the same OAuth-app pattern applies — duplicate `notion-auth.ts` for Linear, key the stored token by `"linear"`, and the discovery CLI's adapter will pick it up on the next activation.
