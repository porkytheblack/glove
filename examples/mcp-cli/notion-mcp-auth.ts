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
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

import { FsMcpOAuthProvider } from "./lib/mcp-oauth";
import { MCP_CLIENT_INFO, buildClientMetadata } from "./lib/mcp-client-info";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCP-spec OAuth flow against https://mcp.notion.com/mcp.
//
// Unlike `notion-auth.ts` (which runs api.notion.com OAuth and gives you a
// Notion API token), this script runs the OAuth flow defined by the MCP
// authorization spec — discovery, dynamic client registration, PKCE — against
// the MCP server itself. The resulting token is for `mcp.notion.com` and
// represents *your Notion access*, not a separate integration's access. No
// page-sharing dance, no Public-integration setup. Same path Claude Code uses.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STORE_PATH = join(__dirname, ".mcp-oauth.json");

interface CliConfig {
  serverUrl: string;
  port: number;
  redirectUrl: string;
}

function readConfig(): CliConfig {
  const serverUrl = process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp";
  const port = Number(process.env.NOTION_MCP_OAUTH_PORT ?? "53683");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid NOTION_MCP_OAUTH_PORT: ${process.env.NOTION_MCP_OAUTH_PORT}`);
  }
  const redirectUrl =
    process.env.NOTION_MCP_OAUTH_REDIRECT_URI ?? `http://localhost:${port}/callback`;
  return { serverUrl, port, redirectUrl };
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
  state: string;
}

function awaitCallback(
  port: number,
  timeoutMs: number,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        respondHtml(res, 400, "Authorization failed", [
          `<p>OAuth server returned <code>${escapeHtml(oauthError)}</code>.</p>`,
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

      respondHtml(res, 200, "Notion connected", [
        '<p style="font-size:1.1rem">✅ <strong>Notion access granted.</strong></p>',
        "<p>You can close this tab and return to the terminal.</p>",
      ]);
      cleanup();
      resolve({ code, state });
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
      "Notion MCP OAuth setup",
      "======================",
      "",
      `  Server:        ${config.serverUrl}`,
      `  Redirect URI:  ${config.redirectUrl}`,
      `  Listening on:  http://127.0.0.1:${config.port}`,
      "",
      "This runs the MCP authorization spec OAuth flow — no client-id or",
      "client-secret needed (the server registers us dynamically).",
      "",
    ].join("\n"),
  );

  // Set up the local listener BEFORE we touch the SDK so a fast user can't
  // hit /callback before we're ready.
  const callbackPromise = awaitCallback(config.port, 5 * 60 * 1000);

  // Construct an OAuth provider keyed by "notion". The SDK calls
  // saveClientInformation, saveCodeVerifier, saveTokens at the right moments.
  const provider = new FsMcpOAuthProvider(STORE_PATH, "notion", {
    redirectUrl: config.redirectUrl,
    clientMetadata: buildClientMetadata(config.redirectUrl),
    onAuthorizeUrl(url: URL) {
      output.write(
        [
          "Opening Notion authorization page in your browser. If it doesn't",
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

  // Reset any previous half-completed state — re-running auth should start
  // clean even if the file has stale partial data.
  await provider.reset();

  // Build a transport with the auth provider. The SDK will:
  //   1. Discover OAuth metadata from the server
  //   2. Register us via DCR (saveClientInformation)
  //   3. Generate PKCE (saveCodeVerifier)
  //   4. Build authorize URL and call provider.redirectToAuthorization
  //   5. Throw UnauthorizedError because we don't have tokens yet
  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl), {
    authProvider: provider,
  });
  const client = new Client(MCP_CLIENT_INFO);

  try {
    await client.connect(transport);
    // If this succeeds, we somehow already had valid tokens — surprising
    // because we just reset, but harmless.
    output.write("\nAlready authorized (existing valid tokens). Closing.\n");
    await client.close();
    return;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      output.write(
        `\nDiscovery / registration failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      output.write(
        `\nTip: make sure ${config.serverUrl} actually exposes the MCP authorization\n` +
          `endpoints (.well-known/oauth-authorization-server etc.). For non-MCP-spec\n` +
          `Notion auth, use \`pnpm mcp:notion-auth\` instead.\n\n`,
      );
      process.exit(1);
    }
    // Expected — the provider has now been pointed at the authorize URL.
  }

  // 6. Wait for the user to grant access; the redirect lands on /callback.
  let cb: CallbackResult;
  try {
    cb = await callbackPromise;
  } catch (err) {
    output.write(`\nAuth flow aborted: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exit(1);
  }

  output.write("Received authorization code. Exchanging for an access token...\n");

  // 7. Hand the code back to the transport — it loads the saved code_verifier
  //    and exchanges code for tokens, saving them via saveTokens.
  try {
    await transport.finishAuth(cb.code);
  } catch (err) {
    output.write(`\nToken exchange failed: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exit(1);
  }

  // 8. Reconnect with a fresh transport to verify the saved tokens work.
  const verifyTransport = new StreamableHTTPClientTransport(new URL(config.serverUrl), {
    authProvider: provider,
  });
  const verifyClient = new Client(MCP_CLIENT_INFO);

  try {
    await verifyClient.connect(verifyTransport);
    const tools = await verifyClient.listTools();
    output.write(
      [
        "",
        "✓ MCP OAuth flow complete and verified.",
        "",
        `  Server:    ${config.serverUrl}`,
        `  Tools:     ${tools.tools.length} available`,
        `  Saved to:  examples/mcp-cli/.mcp-oauth.json`,
        "",
        "Next:",
        "  pnpm mcp:notion           # focused Notion agent",
        "  pnpm mcp:cli              # multi-MCP discovery agent",
        "",
      ].join("\n"),
    );
    await verifyClient.close();
  } catch (err) {
    output.write(
      `\nWarning: tokens were saved but the verification connect failed: ${err instanceof Error ? err.message : String(err)}\n` +
        `You can still try the agent — it'll reuse the saved tokens. If it fails,\n` +
        `re-run \`pnpm mcp:notion-mcp-auth\` to start fresh.\n\n`,
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
