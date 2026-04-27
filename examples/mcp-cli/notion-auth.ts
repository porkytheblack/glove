import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { stdout as output } from "node:process";

import { FsTokenStore, type StoredToken } from "./lib/token-store";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notion OAuth constants
//
// Notion uses a vanilla OAuth 2.0 authorization-code flow with HTTP Basic
// auth on the token endpoint. No PKCE, no refresh tokens — access tokens are
// long-lived. Reference: https://developers.notion.com/docs/authorization
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
}

interface NotionTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string | null;
  workspace_icon?: string | null;
  duplicated_template_id?: string | null;
  owner?: unknown;
  request_id?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function readConfigFromEnv(): NotionOAuthConfig {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  const port = Number(process.env.NOTION_OAUTH_PORT ?? "53682");
  const redirectUri =
    process.env.NOTION_OAUTH_REDIRECT_URI ?? `http://localhost:${port}/callback`;

  const missing: string[] = [];
  if (!clientId) missing.push("NOTION_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("NOTION_OAUTH_CLIENT_SECRET");

  if (missing.length) {
    output.write(
      [
        "",
        `Missing required env var${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
        "",
        "To set up Notion OAuth:",
        "  1. https://www.notion.so/profile/integrations  →  New integration  →  Public",
        "  2. Set the redirect URI to:",
        `       ${redirectUri}`,
        "  3. Copy the client id & client secret into examples/mcp-cli/.env:",
        "       NOTION_OAUTH_CLIENT_ID=...",
        "       NOTION_OAUTH_CLIENT_SECRET=...",
        "  4. Re-run this command.",
        "",
        "See examples/mcp-cli/README.md for the detailed walkthrough.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid NOTION_OAUTH_PORT: ${process.env.NOTION_OAUTH_PORT}`);
  }

  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri, port };
}

function buildAuthorizeUrl(config: NotionOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: config.redirectUri,
    state,
  });
  return `${NOTION_AUTH_URL}?${params.toString()}`;
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
      // Don't crash — the user can still copy the URL from stdout.
      output.write(
        `\n(Could not auto-open browser. Visit the URL above manually.)\n`,
      );
    }
  });
}

async function exchangeCodeForToken(
  config: NotionOAuthConfig,
  code: string,
): Promise<NotionTokenResponse> {
  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");

  const response = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  const body = (await response.json()) as
    | NotionTokenResponse
    | { error?: string; error_description?: string };

  if (!response.ok) {
    const err = body as { error?: string; error_description?: string };
    throw new Error(
      `Notion token exchange failed (${response.status}): ${err.error ?? "unknown_error"}` +
        (err.error_description ? ` — ${err.error_description}` : ""),
    );
  }

  if (!("access_token" in body) || !body.access_token) {
    throw new Error(
      "Notion token exchange returned no access_token. Response: " +
        JSON.stringify(body),
    );
  }

  return body as NotionTokenResponse;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Local callback listener
//
// Awaits exactly one /callback hit, validates `state`, and resolves with the
// authorization code. Times out after 5 minutes so we don't hang forever if
// the user closes the browser.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface CallbackResult {
  code: string;
}

function awaitCallback(
  port: number,
  expectedState: string,
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
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        respondHtml(res, 400, "Authorization failed", [
          `<p>Notion returned an error: <code>${escapeHtml(oauthError)}</code></p>`,
          "<p>You can close this tab and re-run the auth command.</p>",
        ]);
        cleanup();
        reject(new Error(`Authorization denied: ${oauthError}`));
        return;
      }

      if (!code) {
        respondHtml(res, 400, "Missing code", [
          "<p>Notion did not return an authorization code.</p>",
        ]);
        cleanup();
        reject(new Error("Callback received without `code` parameter."));
        return;
      }

      if (state !== expectedState) {
        respondHtml(res, 400, "State mismatch", [
          "<p>The <code>state</code> parameter did not match. Possible CSRF — refusing to continue.</p>",
        ]);
        cleanup();
        reject(new Error("OAuth state mismatch — possible CSRF."));
        return;
      }

      respondHtml(res, 200, "Notion connected", [
        "<p style=\"font-size:1.1rem\">✅ <strong>Notion access granted.</strong></p>",
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

function respondHtml(
  res: ServerResponse,
  status: number,
  title: string,
  body: string[],
): void {
  const html =
    "<!doctype html><html><head>" +
    `<meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    "<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#222;}code{background:#eee;padding:.1em .3em;border-radius:.25em;}</style>" +
    "</head><body>" +
    `<h1>${escapeHtml(title)}</h1>` +
    body.join("\n") +
    "</body></html>";
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const config = readConfigFromEnv();
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state);

  output.write(
    [
      "",
      "Notion OAuth setup",
      "==================",
      "",
      `  Client ID:    ${config.clientId}`,
      `  Redirect URI: ${config.redirectUri}`,
      `  Listening on: http://127.0.0.1:${config.port}`,
      "",
      "Opening Notion authorization page in your browser. If it doesn't",
      "open automatically, copy this URL into a browser yourself:",
      "",
      `  ${authorizeUrl}`,
      "",
      "Waiting for you to grant access...",
      "",
    ].join("\n"),
  );

  // Start listening BEFORE we open the browser, so a fast user can't beat us.
  const callbackPromise = awaitCallback(config.port, state, 5 * 60 * 1000);
  openInBrowser(authorizeUrl);

  let code: string;
  try {
    ({ code } = await callbackPromise);
  } catch (err) {
    output.write(
      `\nAuth flow aborted: ${err instanceof Error ? err.message : String(err)}\n\n`,
    );
    process.exit(1);
  }

  output.write("Received authorization code. Exchanging for an access token...\n");

  let token: NotionTokenResponse;
  try {
    token = await exchangeCodeForToken(config, code);
  } catch (err) {
    output.write(
      `\nToken exchange failed: ${err instanceof Error ? err.message : String(err)}\n\n`,
    );
    process.exit(1);
  }

  const stored: StoredToken = {
    access_token: token.access_token,
    obtained_at: new Date().toISOString(),
    meta: {
      bot_id: token.bot_id,
      workspace_id: token.workspace_id,
      workspace_name: token.workspace_name ?? null,
      workspace_icon: token.workspace_icon ?? null,
      owner: token.owner ?? null,
    },
  };

  const store = new FsTokenStore(join(__dirname, ".notion-token.json"));
  await store.set("notion", stored);

  output.write(
    [
      "",
      "✓ Notion access granted and token saved.",
      "",
      `  Workspace:  ${token.workspace_name ?? "(unnamed)"}  [${token.workspace_id}]`,
      `  Bot:        ${token.bot_id}`,
      `  Saved to:   ${join("examples/mcp-cli", ".notion-token.json")}`,
      "",
      "Next:",
      "  pnpm mcp:notion           # focused Notion agent",
      "  pnpm mcp:cli              # multi-MCP discovery agent",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
