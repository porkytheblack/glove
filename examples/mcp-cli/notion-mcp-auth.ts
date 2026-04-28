import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import { stdout as output } from "node:process";
import { FsOAuthStore, runMcpOAuth } from "glove-mcp/oauth";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCP-spec OAuth flow against https://mcp.notion.com/mcp.
//
// Notion's MCP supports DCR — no client_id/secret needed. Same path Claude
// Code uses. Runs the entire flow via runMcpOAuth.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STORE_PATH = join(__dirname, ".mcp-oauth.json");
const SERVER_URL = process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp";
const PORT = Number(process.env.NOTION_MCP_OAUTH_PORT ?? "53683");

async function main() {
  output.write(
    [
      "",
      "Notion MCP OAuth setup",
      "======================",
      "",
      `  Server:        ${SERVER_URL}`,
      `  Listening on:  http://127.0.0.1:${PORT}`,
      "",
      "Notion's MCP supports Dynamic Client Registration — no client_id or",
      "client_secret needed.",
      "",
    ].join("\n"),
  );

  const result = await runMcpOAuth({
    serverUrl: SERVER_URL,
    store: new FsOAuthStore(STORE_PATH),
    key: "notion",
    port: PORT,
    clientInfo: { name: "Glove MCP CLI", version: "0.1.0" },
  });

  if (result.status === "ALREADY_AUTHORIZED") {
    output.write("\nAlready authorized (existing valid tokens). Closing.\n\n");
    return;
  }

  output.write(
    [
      "",
      "✓ Notion MCP OAuth flow complete and verified.",
      "",
      `  Server:    ${SERVER_URL}`,
      `  Tools:     ${result.toolCount} available`,
      `  Saved to:  examples/mcp-cli/.mcp-oauth.json`,
      "",
      "Next:",
      "  pnpm mcp:notion           # focused Notion agent",
      "  pnpm mcp:cli              # multi-MCP discovery agent",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  output.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exit(1);
});
