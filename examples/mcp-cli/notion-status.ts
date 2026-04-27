import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import { stdout as output } from "node:process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { FsMcpOAuthProvider } from "./lib/mcp-oauth";
import { MCP_CLIENT_INFO, buildClientMetadata } from "./lib/mcp-client-info";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Diagnostic — reads .mcp-oauth.json, prints what's persisted (with secrets
// masked), then tries the saved access_token against the server twice:
//
//   1. Through the MCP SDK (same code path the agent uses)
//   2. As a direct fetch with an Authorization: Bearer header (raw HTTP)
//
// Different outcomes between the two narrows down where the bug is.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STORE_PATH = join(__dirname, ".mcp-oauth.json");
const SERVER_URL = process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp";

function authRedirectUrl(): string {
  if (process.env.NOTION_MCP_OAUTH_REDIRECT_URI)
    return process.env.NOTION_MCP_OAUTH_REDIRECT_URI;
  const port = process.env.NOTION_MCP_OAUTH_PORT ?? "53683";
  return `http://localhost:${port}/callback`;
}

function mask(s: string | undefined | null, keep = 6): string {
  if (!s) return "(missing)";
  if (s.length <= keep * 2) return `${s.slice(0, 2)}...${s.slice(-2)} (len=${s.length})`;
  return `${s.slice(0, keep)}...${s.slice(-4)} (len=${s.length})`;
}

async function inspectFile(): Promise<{ hasTokens: boolean; accessToken: string | undefined }> {
  output.write("\n--- token store ---\n");
  output.write(`Path: ${STORE_PATH}\n`);

  if (!existsSync(STORE_PATH)) {
    output.write("File: (does not exist — run `pnpm mcp:notion-mcp-auth` first)\n");
    return { hasTokens: false, accessToken: undefined };
  }

  const st = await stat(STORE_PATH);
  output.write(`File: ${st.size} bytes, mode ${(st.mode & 0o777).toString(8)}\n`);

  const provider = new FsMcpOAuthProvider(STORE_PATH, "notion", {
    redirectUrl: authRedirectUrl(),
    clientMetadata: buildClientMetadata(authRedirectUrl()),
    onAuthorizeUrl: () => {},
  });

  const tokens = await provider.tokens();
  const clientInfo = await provider.clientInformation();

  output.write(`\nProvider: notion\n`);
  output.write(`  clientInformation:\n`);
  if (!clientInfo) {
    output.write(`    (missing — DCR didn't save anything)\n`);
  } else {
    const ci = clientInfo as Record<string, unknown>;
    output.write(`    client_id:                 ${mask(ci.client_id as string | undefined)}\n`);
    output.write(`    client_secret:             ${mask(ci.client_secret as string | undefined)}\n`);
    output.write(`    registration_access_token: ${mask(ci.registration_access_token as string | undefined)}\n`);
  }

  output.write(`\n  tokens:\n`);
  if (!tokens) {
    output.write(`    (missing)\n`);
    return { hasTokens: false, accessToken: undefined };
  }

  output.write(`    access_token:    ${mask(tokens.access_token)}\n`);
  output.write(`    token_type:      ${tokens.token_type ?? "(missing)"}\n`);
  output.write(`    expires_in:      ${tokens.expires_in ?? "(missing)"}\n`);
  output.write(`    refresh_token:   ${mask(tokens.refresh_token ?? undefined)}\n`);
  output.write(`    scope:           ${tokens.scope ?? "(missing)"}\n`);

  return { hasTokens: true, accessToken: tokens.access_token };
}

async function testRawFetch(accessToken: string): Promise<void> {
  output.write("\n--- raw HTTP probe ---\n");
  output.write(`POST ${SERVER_URL} (initialize) with Authorization: Bearer <token>\n`);

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO,
    },
  };

  try {
    const resp = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    output.write(`Status:  ${resp.status} ${resp.statusText}\n`);
    output.write(`Headers: ${JSON.stringify(Object.fromEntries(resp.headers), null, 2)}\n`);
    output.write(`Body:    ${text.slice(0, 600)}${text.length > 600 ? "..." : ""}\n`);
  } catch (err) {
    output.write(`Failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function testViaSdk(): Promise<void> {
  output.write("\n--- MCP SDK probe ---\n");
  output.write(`Connecting via StreamableHTTPClientTransport with FsMcpOAuthProvider\n`);

  const provider = new FsMcpOAuthProvider(STORE_PATH, "notion", {
    redirectUrl: authRedirectUrl(),
    clientMetadata: buildClientMetadata(authRedirectUrl()),
    onAuthorizeUrl: () => {
      throw new Error("(diagnostic) SDK tried to redirect — token must have been rejected and the provider needs to re-auth");
    },
  });

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
    authProvider: provider,
  });
  const client = new Client(MCP_CLIENT_INFO);

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    output.write(`Connected. ${tools.tools.length} tools available.\n`);
    await client.close();
  } catch (err) {
    output.write(`Failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

async function main() {
  output.write("Notion MCP OAuth status\n");
  output.write("=======================\n");
  output.write(`Server:      ${SERVER_URL}\n`);
  output.write(`Redirect URI: ${authRedirectUrl()}\n`);

  const { hasTokens, accessToken } = await inspectFile();
  if (!hasTokens || !accessToken) {
    output.write(
      "\nNo tokens to probe. Run `pnpm mcp:notion-mcp-auth` and re-run this.\n\n",
    );
    process.exit(1);
  }

  await testRawFetch(accessToken);
  await testViaSdk();

  output.write("\nDone.\n\n");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
