# glove-mcp examples

Four server-side CLIs that exercise `glove-mcp`:

| Command                    | File                | What it does |
|----------------------------|---------------------|--------------|
| `pnpm mcp:notion-auth`     | `notion-auth.ts`    | Runs the full Notion OAuth 2.0 authorization-code flow — local callback listener, browser open, code-for-token exchange, token persisted to `.notion-token.json` (mode 0600). |
| `pnpm mcp:notion-server`   | `notion-server.ts`  | Long-running. Spawns `@notionhq/notion-mcp-server` behind `mcp-proxy`, using the OAuth token from the previous step. Exposes Streamable HTTP at `http://localhost:3030/mcp`. |
| `pnpm mcp:notion`          | `notion-agent.ts`   | Focused Notion agent — connects to whatever's listening at `NOTION_MCP_URL` (defaults to `http://localhost:3030/mcp`). Pre-activates Notion at startup. |
| `pnpm mcp:cli`             | `index.ts`          | Multi-MCP agent with `find_capability` discovery (Notion + Linear catalogue). Resolves tokens the same way `notion-agent.ts` does. |

`glove-mcp` itself ships **no OAuth machinery** — `McpAdapter.getAccessToken(id)` is the only seam where consumers plug in. `notion-auth.ts` is a complete reference consumer: it owns the OAuth flow, persists the result, and the agents read from the persisted store via the adapter. Lift it into a real product and swap `FsTokenStore` for whatever your backend uses.

---

## Why the flow has three steps (and not two)

The hosted **`https://mcp.notion.com/mcp`** uses its **own** OAuth issuer, per the MCP authorization spec (PKCE + DCR, audience = `mcp.notion.com`). The OAuth token you get from **`api.notion.com`** is a *Notion API* token — totally valid, but `mcp.notion.com` rejects it as audience-mismatched.

So the practical path for a server-to-server agent is:

1. **`mcp:notion-auth`** — get an `api.notion.com` OAuth token. (One-time per user.)
2. **`mcp:notion-server`** — run Notion's official MCP server (`@notionhq/notion-mcp-server`) locally with that token. It speaks stdio; we put `mcp-proxy` in front of it so glove-mcp can reach it over HTTP.
3. **`mcp:notion`** — point the agent at the local proxy.

The OAuth token works in step 2 because `notion-mcp-server` calls `api.notion.com` directly — same audience as the token. (Future glove-mcp versions may add support for the MCP authorization spec so step 2 disappears.)

---

## End-to-end setup

### 1. Create a Public integration in Notion

1. <https://www.notion.so/profile/integrations> → **+ New integration** → **Public**.
2. **Redirect URIs** — add **`http://localhost:53682/callback`** (the literal string with the path; Notion compares exact-string). Save.
3. **Capabilities** — at minimum check `Read content`, `Update content`, `Insert content`. (You can change these later but users have to re-authorize.)
4. Open the integration's settings, scroll to **Secrets**:
   - Copy the **OAuth client ID** (UUID).
   - Click **Show** next to **OAuth client secret** and copy that.

### 2. Drop credentials into `.env`

```sh
cp examples/mcp-cli/.env.example examples/mcp-cli/.env
```

```env
ANTHROPIC_API_KEY=sk-ant-...
NOTION_OAUTH_CLIENT_ID=12345678-1234-1234-1234-123456789012
NOTION_OAUTH_CLIENT_SECRET=secret_...
```

### 3. Run the OAuth flow (one-time)

```sh
pnpm install
pnpm mcp:notion-auth
```

The CLI prints a banner with the redirect URI it expects and the authorize URL, opens your browser to Notion's consent page, listens on `http://localhost:53682/callback`, validates the `state` parameter, exchanges the code, and writes the access token to `examples/mcp-cli/.notion-token.json`.

```
✓ Notion access granted and token saved.

  Workspace:  My Awesome Workspace  [aaaa-bbbb-...]
  Bot:        cccc-dddd-...
  Saved to:   examples/mcp-cli/.notion-token.json
```

### 4. Start the local Notion MCP server (long-running)

```sh
pnpm mcp:notion-server
```

This spawns:

```
npx -y mcp-proxy --port 3030 -- npx -y @notionhq/notion-mcp-server
```

with `NOTION_TOKEN` automatically set from the OAuth token you just saved. First run downloads the two npm packages — give it 30–60 seconds. Subsequent runs are instant. The server stays running until you Ctrl-C it.

### 5. Run the agent (in another terminal)

```sh
pnpm mcp:notion
```

The agent runs a preflight `listTools` call (so a stale token / missing server fails loudly with a focused message), then drops into a REPL with `notion__*` tools available on turn one.

```
Connecting to Notion MCP at http://localhost:3030/mcp...
Connected to workspace "My Awesome Workspace". 14 Notion tools available: notion__search, notion__fetch, ...
Notion agent ready. Type your message, or '/exit' to quit.
> Find the roadmap doc and add a bullet under "Q3" saying "Ship MCP integration"
```

---

## How the pieces fit together

```
   ┌──────────────────┐   OAuth code/state    ┌────────────────────┐
   │ pnpm mcp:notion- │ ────────────────────► │ api.notion.com     │
   │      auth        │ ◄──────── token ───── │ (OAuth issuer)     │
   └────────┬─────────┘                       └────────────────────┘
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
   │   1. process.env.NOTION_TOKEN  (override)            │
   │   2. tokenStore.get("notion")  (OAuth path)          │
   └────────┬─────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────┐  Authorization: Bearer ...   ┌────────────────────┐
   │ glove-mcp        │ ────────────────────────────►│ mcp-proxy :3030    │
   │ connectMcp(...)  │                              │  └─ stdio: notion- │
   └──────────────────┘                              │     mcp-server     │
                                                     │     └─ api.notion. │
                                                     │        com         │
                                                     └────────────────────┘
                                                     ↑ pnpm mcp:notion-server
```

Three things to notice:

1. **Token resolution happens per-connection, not at process start.** `getAccessToken` is called inside `connectMcp` every time, so when you eventually add token refresh you can update the stored token and the next connection picks it up automatically.
2. **Env var beats stored token.** Useful when you already have an internal integration token (`ntn_…`) and want to bypass OAuth, or for CI runs.
3. **`auth_expired` is the contract.** If a token expires mid-session, the bridged tool returns `{ status: "error", message: "auth_expired" }`. The agent's subscriber surfaces these as `[tool error: auth_expired]` lines.

---

## Production lift-and-shift

Everything in this folder is reusable. To go to production:

- Replace `FsTokenStore` with a per-user store backed by your DB. Two-method interface (`get`, `set`).
- Move `notion-auth.ts` from a CLI into route handlers — `GET /oauth/notion/start` redirects, `GET /oauth/notion/callback` does what the local listener does today, keyed by your user id rather than the literal `"notion"`.
- For the MCP server: either run `notion-mcp-server` per-user (one process per active conversation, expensive), per-tenant, or in a shared pool. Or wait for `glove-mcp` to add support for the MCP authorization spec so you can hit `mcp.notion.com` directly from your agent runtime.
- Agent code (`notion-agent.ts`) doesn't change — only the `McpAdapter` implementation differs.

---

## Alternative: skip OAuth entirely

If you don't need multi-user OAuth:

1. <https://www.notion.so/profile/integrations> → **New integration** → **Internal**.
2. Copy the **Internal Integration Secret** (`ntn_…` or `secret_…`).
3. In Notion, share each page/database with the integration (`•••` → **Connections** → connect).
4. In `.env`:
   ```env
   NOTION_TOKEN=ntn_...
   ```
5. `pnpm mcp:notion-server` then `pnpm mcp:notion`. Skip `pnpm mcp:notion-auth` — `getAccessToken` sees `NOTION_TOKEN` set in env and uses it directly.

The agent works identically; only the auth source changes.

---

## Troubleshooting

- **`Failed to connect... ECONNREFUSED localhost:3030`** — `pnpm mcp:notion-server` isn't running, or it's running on a different port. Start it in a separate terminal.
- **`The MCP server rejected the token`** / **`401 Unauthorized`** — usually the audience-mismatch issue: you've set `NOTION_MCP_URL=https://mcp.notion.com/mcp` but your token came from `api.notion.com`. Unset `NOTION_MCP_URL` (defaults to local proxy) and run `pnpm mcp:notion-server`.
- **`Authorization failed: redirect_uri_mismatch`** during `mcp:notion-auth` — the URI in your Notion integration must match exactly. The CLI prints `Redirect URI: http://localhost:53682/callback`; that exact string (with the `/callback` path) must appear in your integration's redirect-URIs list. The chip-input doesn't auto-save — click **Save** at the bottom of the page.
- **`Notion token exchange failed (401): invalid_client`** — copy-paste error in `NOTION_OAUTH_CLIENT_SECRET`. Click **Show** again, copy the entire string, no leading/trailing whitespace.
- **`No access token for "notion"`** — you haven't run `pnpm mcp:notion-auth`, or the token file got deleted. Run it again.
- **Empty tool list after preflight** — for the OAuth path, your authorized scopes don't actually grant any capability; re-run the auth flow and grant pages on Notion's consent screen. For the internal-integration path, you haven't shared any pages with the integration yet.
- **`auth_expired` mid-conversation** — token is no longer valid. Re-run `pnpm mcp:notion-auth` and restart the agent.
- **Tool name confusion** — bridged tools are namespaced. A Notion `search` tool shows up to the model as `notion__search`. The `__` separator is regex-safe across model providers.

---

## Linear (used by the multi-MCP CLI)

Linear's hosted MCP at `https://mcp.linear.app/mcp` works the same way. Quick path for a personal CLI: use a personal API key from <https://linear.app/settings/api> as the bearer token.

```env
LINEAR_TOKEN=lin_api_...
```

For multi-user setups, mirror the Notion pattern — duplicate `notion-auth.ts` for Linear, key the stored token by `"linear"`, and the discovery CLI's adapter picks it up on the next activation.
