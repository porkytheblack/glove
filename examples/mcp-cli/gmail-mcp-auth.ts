import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { stdout as output } from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import {
  FsOAuthStore,
  McpOAuthProvider,
  buildClientMetadata,
  type McpOAuthProviderOptions,
} from "glove-mcp/oauth";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCP-spec OAuth flow against https://gmailmcp.googleapis.com/mcp/v1.
//
// Two Gmail-specific quirks this file handles, beyond what `runMcpOAuth` does:
//
//  1. **No DCR.** Gmail's MCP rejects Dynamic Client Registration; you create
//     an OAuth 2.0 client manually in Google Cloud Console (Web app type)
//     and we pre-seed `client_id` + `client_secret` into the store.
//
//  2. **No RFC 8707 `resource` parameter.** Gmail MCP's protected-resource
//     metadata advertises `resource: "https://gmailmcp.googleapis.com/mcp/v1"`,
//     and the MCP SDK appends `resource=…` to authorize and token requests
//     by default. Google's stock OAuth token endpoint
//     (`oauth2.googleapis.com/token`) doesn't implement RFC 8707 and rejects
//     unknown params with an HTML 400. The `GmailOAuthProvider` subclass
//     below overrides `validateResourceURL` to return undefined, which makes
//     the SDK skip the param everywhere.
//
// Both quirks are app-specific Gmail workarounds — they don't belong in the
// generic `runMcpOAuth` helper.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STORE_PATH = join(__dirname, ".mcp-oauth.json");
const SERVER_URL =
  process.env.GMAIL_MCP_URL ?? "https://gmailmcp.googleapis.com/mcp/v1";
const PORT = Number(process.env.GMAIL_OAUTH_PORT ?? "53684");
const REDIRECT_URL =
  process.env.GMAIL_OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/callback`;

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

const CLIENT_INFO = { name: "Glove MCP CLI", version: "0.1.0" };

class GmailOAuthProvider extends McpOAuthProvider {
  constructor(opts: McpOAuthProviderOptions) {
    super(opts);
  }
  // Suppress RFC 8707 `resource` on authorize + token requests. Google's
  // OAuth endpoint rejects requests carrying it.
  async validateResourceURL(): Promise<URL | undefined> {
    return undefined;
  }
}

async function main() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET ?? "";

  const missing: string[] = [];
  if (!clientId) missing.push("GMAIL_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GMAIL_OAUTH_CLIENT_SECRET");

  if (missing.length) {
    output.write(
      [
        "",
        `Missing required env var${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
        "",
        "Gmail's MCP requires a manually-registered OAuth 2.0 client.",
        "Setup steps:",
        "  1. https://console.cloud.google.com/  →  pick or create a project",
        "  2. APIs & Services → Library → enable BOTH:",
        "       · Gmail API",
        "       · Gmail MCP API",
        "  3. APIs & Services → OAuth consent screen → Data Access → add scopes:",
        "       · https://www.googleapis.com/auth/gmail.readonly",
        "       · https://www.googleapis.com/auth/gmail.compose",
        "       · https://www.googleapis.com/auth/gmail.modify",
        "  4. APIs & Services → Credentials → Create credentials → OAuth client ID:",
        "       · Application type: Web application",
        `       · Authorized redirect URIs: ${REDIRECT_URL}`,
        "  5. Copy client_id + client_secret into examples/mcp-cli/.env:",
        "       GMAIL_OAUTH_CLIENT_ID=...",
        "       GMAIL_OAUTH_CLIENT_SECRET=...",
        "  6. Re-run this command.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  output.write(
    [
      "",
      "Gmail MCP OAuth setup",
      "=====================",
      "",
      `  Server:        ${SERVER_URL}`,
      `  Client ID:     ${clientId}`,
      `  Redirect URI:  ${REDIRECT_URL}`,
      `  Listening on:  http://127.0.0.1:${PORT}`,
      `  Scopes:        gmail.readonly, gmail.compose, gmail.modify`,
      "",
    ].join("\n"),
  );

  const store = new FsOAuthStore(STORE_PATH);
  const provider = new GmailOAuthProvider({
    store,
    key: "gmail",
    redirectUrl: REDIRECT_URL,
    clientMetadata: buildClientMetadata({
      redirectUrl: REDIRECT_URL,
      scope: GMAIL_SCOPES,
      tokenEndpointAuthMethod: "client_secret_basic",
      clientName: CLIENT_INFO.name,
    }),
    onAuthorizeUrl(url: URL) {
      output.write(
        [
          "Opening Google authorization page in your browser. If it doesn't",
          "open automatically, copy this URL into a browser yourself:",
          "",
          `  ${url.toString()}`,
          "",
          "Waiting for you to grant access...",
          "",
        ].join("\n"),
      );
      openInBrowser(url.toString());
    },
  });

  // Wipe any half-completed state, then pre-seed the manually-registered
  // client info (Gmail's MCP doesn't support DCR).
  await provider.reset();
  await provider.saveClientInformation({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: CLIENT_INFO.name,
    redirect_uris: [REDIRECT_URL],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_basic",
    scope: GMAIL_SCOPES,
  });

  // Start the local callback listener *before* triggering the redirect — the
  // user's browser will hit it as soon as they grant access.
  const callbackPromise = awaitCallback(PORT, 5 * 60 * 1000);

  let initial: "AUTHORIZED" | "REDIRECT";
  try {
    // Pass `scope` explicitly so the SDK's resolvedScope picks our list
    // (auth.js:224 — `scope || resourceMetadata?.scopes_supported?.join(' ') || …`).
    // Without this, Gmail MCP's PRM advertises 5 scopes including
    // `gmail.metadata`, which is a *cap* — once granted, every API call is
    // forced metadata-only.
    initial = await auth(provider, { serverUrl: SERVER_URL, scope: GMAIL_SCOPES });
  } catch (err) {
    output.write(
      `\nAuth flow setup failed: ${err instanceof Error ? err.message : String(err)}\n` +
        `\nDouble-check: Gmail MCP API is enabled, OAuth client type is "Web application",\n` +
        `and the redirect URI matches exactly.\n\n`,
    );
    process.exit(1);
  }

  if (initial === "AUTHORIZED") {
    output.write("\nAlready authorized (existing valid tokens). Closing.\n\n");
    return;
  }

  let cb: { code: string };
  try {
    cb = await callbackPromise;
  } catch (err) {
    output.write(`\nAuth flow aborted: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exit(1);
  }

  output.write("Received authorization code. Exchanging for an access token...\n");

  let final: "AUTHORIZED" | "REDIRECT";
  try {
    final = await auth(provider, {
      serverUrl: SERVER_URL,
      authorizationCode: cb.code,
      scope: GMAIL_SCOPES,
    });
  } catch (err) {
    output.write(`\nToken exchange failed: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exit(1);
  }

  if (final !== "AUTHORIZED") {
    output.write(`\nUnexpected auth result: ${final}\n\n`);
    process.exit(1);
  }

  // Verify with a real authenticated tool call. list_labels is harmless and
  // requires gmail.readonly — exactly the scope we asked for.
  const verifyTransport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
    authProvider: provider,
  });
  const verifyClient = new Client(CLIENT_INFO);

  try {
    await verifyClient.connect(verifyTransport);
    const result = await verifyClient.callTool({ name: "list_labels", arguments: {} });
    const labelCount =
      Array.isArray((result.structuredContent as { labels?: unknown[] } | undefined)?.labels)
        ? ((result.structuredContent as { labels: unknown[] }).labels.length)
        : "?";
    output.write(
      [
        "",
        "✓ Gmail MCP OAuth flow complete and verified.",
        "",
        `  Server:      ${SERVER_URL}`,
        `  list_labels: returned ${labelCount} user labels (auth works)`,
        `  Saved to:    examples/mcp-cli/.mcp-oauth.json`,
        "",
        "Next:",
        "  pnpm mcp:gmail            # focused Gmail agent",
        "  pnpm mcp:cli              # multi-MCP discovery agent",
        "",
      ].join("\n"),
    );
    await verifyClient.close();
  } catch (err) {
    output.write(
      `\nWarning: tokens were saved but verification failed: ${err instanceof Error ? err.message : String(err)}\n` +
        `Try running the agent — if it fails too, re-run \`pnpm mcp:gmail-auth\`.\n\n`,
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Local callback listener
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function awaitCallback(port: number, timeoutMs: number): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        respondHtml(res, 400, "Authorization failed", [
          `<p>Google returned <code>${escapeHtml(oauthError)}</code>.</p>`,
        ]);
        cleanup();
        reject(new Error(`Authorization denied: ${oauthError}`));
        return;
      }

      if (!code) {
        respondHtml(res, 400, "Missing code", [
          "<p>Callback did not include an authorization code.</p>",
        ]);
        cleanup();
        reject(new Error("Callback received without `code` parameter."));
        return;
      }

      respondHtml(res, 200, "Gmail connected", [
        '<p style="font-size:1.1rem">✅ <strong>Gmail access granted.</strong></p>',
        "<p>You can close this tab and return to the terminal.</p>",
      ]);
      cleanup();
      resolve({ code });
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for callback.`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }

    server.on("error", (err) => {
      cleanup();
      reject(err);
    });

    server.listen(port, "127.0.0.1");
  });
}

function respondHtml(res: ServerResponse, status: number, title: string, body: string[]): void {
  const html =
    "<!doctype html><html><head>" +
    `<meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    '<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#222;}code{background:#eee;padding:.1em .3em;border-radius:.25em;}</style>' +
    "</head><body>" +
    `<h1>${escapeHtml(title)}</h1>` +
    body.join("\n") +
    "</body></html>";
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      output.write(`\n(Could not auto-open browser. Visit the URL above manually.)\n`);
    }
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
