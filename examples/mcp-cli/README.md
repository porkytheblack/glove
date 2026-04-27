# glove-mcp examples

Five server-side CLIs that exercise `glove-mcp`:

| Command                      | File                  | What it does |
|------------------------------|-----------------------|--------------|
| `pnpm mcp:notion-mcp-auth`   | `notion-mcp-auth.ts`  | **Recommended.** Runs the MCP authorization spec OAuth flow against `https://mcp.notion.com/mcp` — Dynamic Client Registration + PKCE. No client id/secret needed. Same path Claude Code uses. |
| `pnpm mcp:notion`            | `notion-agent.ts`     | Focused Notion agent. Defaults to `mcp.notion.com`. Uses `getAuthProvider` to surface the saved MCP OAuth session. |
| `pnpm mcp:cli`               | `index.ts`            | Multi-MCP agent with `find_capability` discovery. |
| `pnpm mcp:notion-auth`       | `notion-auth.ts`      | **Alternative path.** api.notion.com OAuth (Public integration). For pairing with self-hosted `notion-mcp-server`. |
| `pnpm mcp:notion-server`     | `notion-server.ts`    | **Alternative path.** Spawns `@notionhq/notion-mcp-server` behind `mcp-proxy` for the self-hosted setup. |

`glove-mcp` itself ships **no OAuth machinery**. The framework's only auth seam is `McpAdapter.getAccessToken(id)` (bearer) plus the optional `getAuthProvider(id)` (full MCP-spec OAuth). Everything OAuth-related in this folder — `notion-mcp-auth.ts`, `notion-auth.ts`, the `lib/` providers — is consumer-side reference code you can lift into your own app.

---

## Quick start (the path that "just works")

```sh
cp examples/mcp-cli/.env.example examples/mcp-cli/.env
# fill in ANTHROPIC_API_KEY (no Notion config needed for this path)
pnpm install
pnpm mcp:notion-mcp-auth          # one-time OAuth dance
pnpm mcp:notion                   # chat with Notion
```

That's it. Workspace-level access, no Public-integration setup, no page-sharing dance. The first command opens your browser to Notion's MCP consent screen, you pick a workspace, and a token is persisted to `.mcp-oauth.json`.

---

## Two auth paths, side by side

| | **MCP-spec OAuth (recommended)** | **api.notion.com OAuth (alternative)** |
|---|---|---|
| Setup | None — DCR registers the client dynamically. | Create a Public integration, copy client id + secret into `.env`. |
| Server target | `mcp.notion.com/mcp` (Notion's hosted MCP). | `localhost:3030/mcp` (you run `mcp-proxy` + `notion-mcp-server`). |
| Access scope | Workspace-level — what your Notion account can see. | Page-by-page — only what you grant the integration during consent. |
| Database creation, fresh pages | ✓ Just works. | ✗ Needs an existing parent page shared with the integration. |
| Auth file | `.mcp-oauth.json` | `.notion-token.json` |
| Run with | `pnpm mcp:notion-mcp-auth` then `pnpm mcp:notion` | `pnpm mcp:notion-auth` + `pnpm mcp:notion-server` (background) + `pnpm mcp:notion` |
| Matches | Claude Code, Cursor's Notion MCP. | Self-hosted setups, internal integrations. |

The agent picks between them automatically: if `.mcp-oauth.json` has tokens for `notion`, `getAuthProvider` returns a provider and the SDK does the OAuth path. Otherwise it falls back to bearer (`getAccessToken`).

---

## How `getAuthProvider` plugs in

`McpAdapter` got an optional method:

```ts
interface McpAdapter {
  // ...existing
  getAccessToken(id: string): Promise<string>;
  getAuthProvider?(id: string): Promise<OAuthClientProvider | null | undefined>;
}
```

`mountMcp` and the discovery subagent's `activate` tool both check `getAuthProvider` first. When it returns a provider, glove-mcp passes it straight to the MCP SDK's `StreamableHTTPClientTransport`, which handles discovery, DCR, PKCE, token storage, and refresh internally. When it returns `undefined`, glove-mcp falls back to `getAccessToken` + `bearer()`.

The adapter in `notion-agent.ts` shows the pattern:

```ts
async getAuthProvider(id: string) {
  const probe = new FsMcpOAuthProvider(STORE_PATH, id, /* dummy opts */);
  const tokens = await probe.tokens();
  if (!tokens) return undefined;            // no MCP OAuth session — use bearer

  return new FsMcpOAuthProvider(STORE_PATH, id, {
    redirectUrl: "http://localhost/never",
    clientMetadata: { client_name: "Glove MCP CLI", redirect_uris: [] },
    onAuthorizeUrl: () => {
      // We don't auto-open browsers during agent runtime — fail loudly.
      throw new Error(`Run \`pnpm mcp:notion-mcp-auth\` to re-grant access.`);
    },
  });
}
```

Same shape works for any MCP server speaking the MCP authorization spec — Notion, GitHub, anything that exposes `.well-known/oauth-authorization-server`.

---

## How the MCP OAuth flow actually runs (notion-mcp-auth.ts)

```
pnpm mcp:notion-mcp-auth
   │
   ▼
1. Local server listens on http://localhost:53683/callback
   │
   ▼
2. transport = new StreamableHTTPClientTransport(url, { authProvider })
   client.connect(transport)
        │
        ├─► SDK fetches mcp.notion.com/.well-known/oauth-authorization-server
        ├─► SDK POSTs to the registration endpoint (DCR) → saveClientInformation()
        ├─► SDK generates PKCE verifier               → saveCodeVerifier()
        ├─► SDK builds authorize URL                  → redirectToAuthorization()
        │       │
        │       ▼ we open the user's browser
        │
        └─► SDK throws UnauthorizedError (no token yet)
            (we expect this — caught and ignored)
   │
   ▼
3. User grants in browser → Notion redirects to /callback?code=...
   │
   ▼
4. transport.finishAuth(code)
        │
        ├─► SDK loads saved client info + code verifier
        ├─► SDK POSTs to the token endpoint
        └─► SDK calls saveTokens(tokens)
   │
   ▼
5. Reconnect with a fresh transport — tokens load automatically, listTools() works
   │
   ▼
6. Print success, exit
```

The whole thing — including DCR — is roughly 80 lines in `notion-mcp-auth.ts`. The complexity lives in the `FsMcpOAuthProvider` which is just persistence (atomic write, mode 0600).

---

## Production lift-and-shift

For a multi-user app:

- Replace `FsMcpOAuthProvider` with a per-user, per-server provider backed by your DB. The SDK only needs the seven methods on `OAuthClientProvider` — getters for client info / tokens / verifier and the matching savers, plus `redirectUrl`, `clientMetadata`, and `redirectToAuthorization`.
- Move `notion-mcp-auth.ts` from a CLI into route handlers — `GET /oauth/mcp/start` builds a transport and triggers the redirect, `GET /oauth/mcp/callback` calls `transport.finishAuth(code)`.
- The agent code in `notion-agent.ts` doesn't change — `getAuthProvider` is a clean seam.

---

## Self-hosted alternative (the old path)

Use this when:

- You don't trust Notion's hosted MCP server.
- You need internal-integration token semantics.
- You want fine-grained per-page access via Notion's connection model.

Setup:

1. Notion → integrations → New → **Public** (or **Internal** for token-only).
2. For Public: redirect URI `http://localhost:53682/callback`, copy client id/secret into `.env` (`NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`).
3. For Internal: copy the secret into `.env` as `NOTION_TOKEN`, share pages with the integration.
4. Then:

   ```sh
   # Public-integration path:
   pnpm mcp:notion-auth
   # In one terminal:
   pnpm mcp:notion-server
   # In another:
   NOTION_MCP_URL=http://localhost:3030/mcp pnpm mcp:notion
   ```

The agent uses `getAccessToken` + bearer in this mode (since `.mcp-oauth.json` has no entry for `notion`).

---

## Troubleshooting

- **`Failed to connect... 401 Unauthorized`** against `mcp.notion.com` — your `.mcp-oauth.json` is stale or missing. Run `pnpm mcp:notion-mcp-auth` to refresh.
- **`MCP OAuth session for "notion" needs re-authorization`** — token expired and refresh failed. `pnpm mcp:notion-mcp-auth`.
- **`Discovery / registration failed`** during `mcp:notion-mcp-auth` — the URL doesn't expose MCP-spec OAuth metadata. Make sure `NOTION_MCP_URL` (if set) really is an MCP server, not the bare Notion API.
- **Want to switch back to self-hosted** — set `NOTION_MCP_URL=http://localhost:3030/mcp` in `.env`, run `pnpm mcp:notion-server`, and the bearer path activates automatically.
- **`Authorization failed: redirect_uri_mismatch`** during `mcp:notion-auth` (the api.notion.com path) — Notion's integration must have the literal `http://localhost:53682/callback` (with the path) saved in **Redirect URIs**. The chip-input doesn't auto-save — click **Save** at the bottom of the page.
- **Tool name confusion** — bridged tools are namespaced. A Notion `search` tool shows up to the model as `notion__search`. The `__` separator is regex-safe across all model providers.

---

## Linear

Linear's hosted MCP at `https://mcp.linear.app/mcp` should work the same way as Notion's — clone `notion-mcp-auth.ts`, point it at Linear, key the saved tokens by `"linear"`. The discovery CLI's adapter will pick it up automatically.

For a quick personal-use bypass: drop a personal API key from <https://linear.app/settings/api> in `.env`:

```env
LINEAR_TOKEN=lin_api_...
```

The agent's `getAccessToken` returns it as a bearer token.
