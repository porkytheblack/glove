import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import { stdout as output } from "node:process";
import { FsOAuthStore, runMcpOAuth } from "glove-mcp/oauth";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCP-spec OAuth flow against https://gmailmcp.googleapis.com/mcp/v1.
//
// Gmail's MCP doesn't support DCR — you create an OAuth 2.0 client manually
// in Google Cloud Console (Web app type). We pass it as preRegisteredClient
// so the SDK skips DCR.
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
].join(" ");

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
      `  Scopes:        gmail.readonly, gmail.compose`,
      "",
    ].join("\n"),
  );

  const result = await runMcpOAuth({
    serverUrl: SERVER_URL,
    store: new FsOAuthStore(STORE_PATH),
    key: "gmail",
    port: PORT,
    redirectUrl: REDIRECT_URL,
    clientInfo: { name: "Glove MCP CLI", version: "0.1.0" },
    preRegisteredClient: { client_id: clientId, client_secret: clientSecret },
    scope: GMAIL_SCOPES,
    // Gmail returns 200 OK to unauthenticated initialize/tools-list — we have
    // to call a real authenticated tool to verify auth actually works.
    verify: { type: "callTool", name: "list_labels" },
  });

  if (result.status === "ALREADY_AUTHORIZED") {
    output.write("\nAlready authorized (existing valid tokens). Closing.\n\n");
    return;
  }

  output.write(
    [
      "",
      "✓ Gmail MCP OAuth flow complete and verified.",
      "",
      `  Server:     ${SERVER_URL}`,
      `  list_labels: auth works (returned ${describeListLabelsResult(result.verifyResult)})`,
      `  Saved to:   examples/mcp-cli/.mcp-oauth.json`,
      "",
      "Next:",
      "  pnpm mcp:gmail            # focused Gmail agent",
      "  pnpm mcp:cli              # multi-MCP discovery agent",
      "",
    ].join("\n"),
  );
}

function describeListLabelsResult(r: unknown): string {
  if (!r || typeof r !== "object") return "ok";
  const sc = (r as { structuredContent?: { labels?: unknown[] } }).structuredContent;
  if (Array.isArray(sc?.labels)) return `${sc.labels.length} user labels`;
  return "ok";
}

main().catch((err) => {
  output.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exit(1);
});
