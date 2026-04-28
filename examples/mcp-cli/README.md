# glove-mcp examples

Server-side CLIs that exercise `glove-mcp`. Notion + Gmail use the MCP
authorization spec OAuth path against hosted MCP servers; Linear works via
the multi-MCP discovery CLI.

| Command                      | File                  | What it does |
|------------------------------|-----------------------|--------------|
| `pnpm mcp:notion-mcp-auth`   | `notion-mcp-auth.ts`  | **Recommended.** Runs the MCP authorization spec OAuth flow against `https://mcp.notion.com/mcp` — Dynamic Client Registration + PKCE. No client id/secret needed. Same path Claude Code uses. |
| `pnpm mcp:notion`            | `notion-agent.ts`     | Focused Notion agent. Defaults to `mcp.notion.com`. Uses `getAuthProvider` to surface the saved MCP OAuth session. |
| `pnpm mcp:cli`               | `index.ts`            | Multi-MCP agent with `find_capability` discovery. |
| `pnpm mcp:notion-auth`       | `notion-auth.ts`      | **Alternative path.** api.notion.com OAuth (Public integration). For pairing with self-hosted `notion-mcp-server`. |
| `pnpm mcp:notion-server`     | `notion-server.ts`    | **Alternative path.** Spawns `@notionhq/notion-mcp-server` behind `mcp-proxy` for the self-hosted setup. |
| `pnpm mcp:gmail-auth`        | `gmail-mcp-auth.ts`   | OAuth flow for Gmail's hosted MCP at `gmailmcp.googleapis.com/mcp/v1`. Requires manually-registered Google Cloud OAuth client (Gmail's MCP doesn't support DCR). |
| `pnpm mcp:gmail`             | `gmail-agent.ts`      | Focused Gmail agent — search, read, label, draft. Pre-activates Gmail at startup. |

`glove-mcp` ships the MCP authorization spec OAuth machinery via the `glove-mcp/oauth` subpath — `runMcpOAuth` for the auth flow, `FsOAuthStore` / `MemoryOAuthStore` for persistence, `findStoredOAuthProvider` for the agent-runtime adapter seam. Consumers only handle their own OAuth-client setup (client_id/secret for non-DCR servers like Gmail) and persistence backend (file vs DB).

Bare-minimum auth flow:

```ts
import { FsOAuthStore, runMcpOAuth } from "glove-mcp/oauth";

await runMcpOAuth({
  serverUrl: "https://mcp.notion.com/mcp",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "notion",
});
```

For servers that don't support DCR (e.g. Google), pass `preRegisteredClient`:

```ts
await runMcpOAuth({
  serverUrl: "https://gmailmcp.googleapis.com/mcp/v1",
  store: new FsOAuthStore(".mcp-oauth.json"),
  key: "gmail",
  preRegisteredClient: {
    client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
    client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
  },
  scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
  verify: { type: "callTool", name: "list_labels" },
});
```

Bare-minimum adapter:

```ts
import { findStoredOAuthProvider, FsOAuthStore, buildClientMetadata } from "glove-mcp/oauth";

const STORE = new FsOAuthStore(".mcp-oauth.json");

class MyAdapter implements McpAdapter {
  async getAuthProvider(id: string) {
    const redirectUrl = "http://localhost:53683/callback";
    return findStoredOAuthProvider(STORE, id, {
      redirectUrl,
      clientMetadata: buildClientMetadata({ redirectUrl }),
      onAuthorizeUrl: () => { throw new Error(`Run \`my-app auth ${id}\``); },
    });
  }
  // getActive / activate / deactivate / getAccessToken still required by the McpAdapter interface
}
```

Full reference consumer code lives in this folder — each `*-mcp-auth.ts` is ~50 lines on top of `runMcpOAuth`.

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

## Gmail setup

Gmail's hosted MCP server (`https://gmailmcp.googleapis.com/mcp/v1`) is OAuth-protected like Notion's, but with one big difference: **no Dynamic Client Registration**. You create an OAuth 2.0 client manually in Google Cloud Console, copy the credentials into `.env`, and the auth CLI pre-seeds them so the SDK skips DCR.

### One-time setup

1. **Pick a Google Cloud project** — <https://console.cloud.google.com/> → either create a new project or pick an existing one.

2. **Enable two APIs** — APIs & Services → Library → search for and **Enable**:
    - **Gmail API** (`gmail.googleapis.com`)
    - **Gmail MCP API** (`gmailmcp.googleapis.com`)

3. **Configure the OAuth consent screen** — APIs & Services → OAuth consent screen.
    - User type: **External** (unless you're on Workspace; **Internal** is fine there).
    - Fill in the basics (app name, support email, developer email).
    - **Data Access** → **Add or remove scopes** → add **both** of:
        - `https://www.googleapis.com/auth/gmail.readonly`
        - `https://www.googleapis.com/auth/gmail.compose`
    - Save and continue.
    - If your app is in **Testing** mode, add yourself as a Test user (Audience tab).

4. **Create the OAuth client** — APIs & Services → Credentials → **Create credentials** → **OAuth client ID**.
    - Application type: **Web application**.
    - Name: anything (e.g. "Glove MCP CLI").
    - Authorized redirect URIs → **Add URI**: `http://localhost:53684/callback`. (Pick a different port via `GMAIL_OAUTH_PORT` if you want — keep it consistent across `.env` and the registered URI.)
    - **Create**. Copy the **Client ID** and **Client secret** from the modal.

5. **Drop the credentials into `.env`**:

    ```env
    GMAIL_OAUTH_CLIENT_ID=12345-abc.apps.googleusercontent.com
    GMAIL_OAUTH_CLIENT_SECRET=GOCSPX-...
    ```

6. **Run the auth flow**:

    ```sh
    pnpm mcp:gmail-auth
    ```

    Browser opens → Google's consent screen → pick the scopes → grant. The CLI prints success and writes tokens to `.mcp-oauth.json` (under the `"gmail"` key, alongside Notion's).

7. **Run the agent**:

    ```sh
    pnpm mcp:gmail
    ```

    The agent connects to `gmailmcp.googleapis.com/mcp/v1`, runs a preflight `listTools` (expect ~10 tools — `create_draft`, `create_label`, `get_thread`, `label_message`, `label_thread`, `list_drafts`, `list_labels`, `search_threads`, `unlabel_message`, `unlabel_thread`), and drops you into the REPL.

### What the Gmail agent can and can't do

The available scopes are **readonly + compose** — that means:

- ✅ Search and read emails / threads
- ✅ List, apply, and remove labels
- ✅ Create drafts (and let you review/send manually)
- ❌ **Cannot send mail directly.** Add `gmail.send` scope yourself if you need this — the system prompt is conservative on this point.

The discovery CLI (`pnpm mcp:cli`) also picks Gmail up from the catalogue, so a query like *"check if I have any emails from <x>"* will activate Gmail and use those tools automatically. Same auth flow — `mcp:gmail-auth` writes tokens that both CLIs read.

### Troubleshooting Gmail

- **`Gmail MCP API has not been used in project ...`** — you didn't enable `gmailmcp.googleapis.com`. Library → search "Gmail MCP API" → Enable.
- **`Error 400: redirect_uri_mismatch`** — the URI in your Google OAuth client must match what the CLI sends, character-for-character. The CLI prints `Redirect URI: http://localhost:53684/callback`; that exact string must be in **Authorized redirect URIs**.
- **`Error 403: access_denied`** — you're not a Test user and the consent screen is in Testing mode. Add yourself, or publish to Production (subject to Google's verification process if you use sensitive scopes).
- **`invalid_client`** — `GMAIL_OAUTH_CLIENT_SECRET` got copied wrong (whitespace, partial paste). Re-copy from the modal — the secret is shown again under Credentials → click the client.
- **Empty tool list** — auth succeeded but the Gmail MCP API isn't enabled. Check step 2.

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

> **`invalid_token` from `mcp.notion.com` even though `mcp:notion-status` works** — your local `glove-mcp/dist` is stale. The `pnpm mcp:*` scripts all run `pnpm mcp:build` first to prevent this; if you're invoking `tsx` directly, run `pnpm mcp:build` (or `pnpm --filter glove-mcp build`) yourself. `dist/` is gitignored, so `git pull` doesn't update the compiled output.



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
