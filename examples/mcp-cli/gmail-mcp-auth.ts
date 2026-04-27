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

import { FsMcpOAuthProvider } from "./lib/mcp-oauth";
import { MCP_CLIENT_INFO, buildClientMetadata } from "./lib/mcp-client-info";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Gmail's hosted MCP server at https://gmailmcp.googleapis.com/mcp/v1.
//
// Unlike Notion's, Gmail's MCP doesn't support Dynamic Client Registration —
// you create an OAuth 2.0 client manually in Google Cloud Console (Web app
// type) and copy the client_id + client_secret here. We pre-seed the SDK's
// provider with that client info so the OAuth dance skips DCR and goes
// straight to authorize → token.
//
// Required scopes:
//   https://www.googleapis.com/auth/gmail.readonly
//   https://www.googleapis.com/auth/gmail.compose
//
// Required APIs (enable in your Cloud project):
//   gmail.googleapis.com   (Gmail API)
//   gmailmcp.googleapis.com (Gmail MCP API)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STORE_PATH = join(__dirname, ".mcp-oauth.json");

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

interface CliConfig {
  serverUrl: string;
  port: number;
  redirectUrl: string;
  clientId: string;
  clientSecret: string;
}

function readConfig(): CliConfig {
  const serverUrl =
    process.env.GMAIL_MCP_URL ?? "https://gmailmcp.googleapis.com/mcp/v1";
  const port = Number(process.env.GMAIL_OAUTH_PORT ?? "53684");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid GMAIL_OAUTH_PORT: ${process.env.GMAIL_OAUTH_PORT}`);
  }
  const redirectUrl =
    process.env.GMAIL_OAUTH_REDIRECT_URI ?? `http://localhost:${port}/callback`;
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
        "Gmail's MCP requires a manually-registered OAuth 2.0 client (no DCR).",
        "Setup:",
        "  1. https://console.cloud.google.com/  →  pick or create a project",
        "  2. APIs & Services → Library → enable BOTH:",
        "       · Gmail API",
        "       · Gmail MCP API",
        "  3. APIs & Services → OAuth consent screen → Data Access → add scopes:",
        "       · https://www.googleapis.com/auth/gmail.readonly",
        "       · https://www.googleapis.com/auth/gmail.compose",
        "  4. APIs & Services → Credentials → Create credentials → OAuth client ID:",
        "       · Application type: Web application",
        `       · Authorized redirect URIs: ${redirectUrl}`,
        "  5. Copy the client_id + client_secret into examples/mcp-cli/.env:",
        "       GMAIL_OAUTH_CLIENT_ID=...",
        "       GMAIL_OAUTH_CLIENT_SECRET=...",
        "  6. Re-run this command.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  return { serverUrl, port, redirectUrl, clientId, clientSecret };
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

interface CallbackResult {
  code: string;
}

function awaitCallback(port: number, timeoutMs: number): Promise<CallbackResult> {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const config = readConfig();

  output.write(
    [
      "",
      "Gmail MCP OAuth setup",
      "=====================",
      "",
      `  Server:        ${config.serverUrl}`,
      `  Client ID:     ${config.clientId}`,
      `  Redirect URI:  ${config.redirectUrl}`,
      `  Listening on:  http://127.0.0.1:${config.port}`,
      `  Scopes:        gmail.readonly, gmail.compose`,
      "",
      "Gmail's MCP doesn't use Dynamic Client Registration — your manually",
      "registered client_id + client_secret are used directly.",
      "",
    ].join("\n"),
  );

  const callbackPromise = awaitCallback(config.port, 5 * 60 * 1000);

  const provider = new FsMcpOAuthProvider(STORE_PATH, "gmail", {
    redirectUrl: config.redirectUrl,
    clientMetadata: buildClientMetadata({
      redirectUrl: config.redirectUrl,
      scope: GMAIL_SCOPES,
      tokenEndpointAuthMethod: "client_secret_basic",
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

  // Wipe any half-completed state from a prior run, then pre-seed the
  // pre-registered client info. This is what makes the SDK skip DCR.
  await provider.reset();
  await provider.saveClientInformation({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    client_name: "Glove MCP CLI",
    redirect_uris: [config.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_basic",
    scope: GMAIL_SCOPES,
  });

  // Gmail's MCP server returns 200 OK for unauthenticated `initialize` and
  // `tools/list` — auth is only enforced on actual data operations. So we
  // can't rely on the transport's "first request hits 401 → start auth"
  // path that works for mcp.notion.com. Drive `auth()` directly instead.
  let initial: "AUTHORIZED" | "REDIRECT";
  try {
    initial = await auth(provider, { serverUrl: config.serverUrl });
  } catch (err) {
    output.write(
      `\nAuth flow setup failed: ${err instanceof Error ? err.message : String(err)}\n` +
        `\nDouble-check: Gmail MCP API is enabled, OAuth client type is "Web application",\n` +
        `and the redirect URI matches exactly.\n\n`,
    );
    process.exit(1);
  }

  if (initial === "AUTHORIZED") {
    output.write("\nAlready authorized (existing valid tokens). Closing.\n");
    return;
  }

  let cb: CallbackResult;
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
      serverUrl: config.serverUrl,
      authorizationCode: cb.code,
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
  const verifyTransport = new StreamableHTTPClientTransport(new URL(config.serverUrl), {
    authProvider: provider,
  });
  const verifyClient = new Client(MCP_CLIENT_INFO);

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
        `  Server:     ${config.serverUrl}`,
        `  list_labels: returned ${labelCount} user labels (auth works)`,
        `  Saved to:   examples/mcp-cli/.mcp-oauth.json`,
        "",
        "Next:",
        "  pnpm mcp:gmail            # focused Gmail agent",
        "  pnpm mcp:cli              # multi-MCP discovery agent (Notion + Gmail + Linear)",
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

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
