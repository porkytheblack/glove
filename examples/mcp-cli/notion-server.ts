import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import { spawn } from "node:child_process";
import { stdout as output } from "node:process";

import { FsTokenStore } from "./lib/token-store";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Spawn @notionhq/notion-mcp-server behind mcp-proxy so glove-mcp can reach
// it over HTTP. The Notion MCP server speaks stdio and talks to api.notion.com
// using whatever NOTION_TOKEN you give it, so any valid Notion API token works
// here — including the OAuth token persisted by `pnpm mcp:notion-auth`.
//
// Why this script exists: the hosted MCP at https://mcp.notion.com/mcp uses
// its own OAuth issuer (per the MCP authorization spec). Tokens from
// api.notion.com OAuth are not valid for mcp.notion.com — different audience.
// Self-hosting bypasses that.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function resolveToken(): Promise<{ token: string; source: string }> {
  if (process.env.NOTION_TOKEN) {
    return { token: process.env.NOTION_TOKEN, source: "NOTION_TOKEN env var" };
  }
  const store = new FsTokenStore(join(__dirname, ".notion-token.json"));
  const stored = await store.get("notion");
  if (stored?.access_token) {
    return { token: stored.access_token, source: ".notion-token.json" };
  }
  throw new Error(
    "No Notion token available. Run `pnpm mcp:notion-auth` first, or set " +
      "NOTION_TOKEN in examples/mcp-cli/.env (e.g. an internal integration secret).",
  );
}

async function main() {
  const port = Number(process.env.NOTION_MCP_PORT ?? "3030");
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid NOTION_MCP_PORT: ${process.env.NOTION_MCP_PORT}`);
  }

  const { token, source } = await resolveToken();

  output.write(
    [
      "",
      "Notion MCP server (self-hosted)",
      "===============================",
      "",
      `  Token source:    ${source}`,
      `  Listening on:    http://localhost:${port}/mcp`,
      `  Upstream:        @notionhq/notion-mcp-server (stdio) → api.notion.com`,
      "",
      "Set NOTION_MCP_URL in .env if it isn't already:",
      `  NOTION_MCP_URL=http://localhost:${port}/mcp`,
      "",
      "Then in another terminal: pnpm mcp:notion",
      "",
      "Spawning mcp-proxy. First run downloads two npm packages — give it a moment.",
      "",
    ].join("\n"),
  );

  // mcp-proxy spawns the inner stdio server and exposes Streamable HTTP. We
  // pass NOTION_TOKEN to the inner process via env. Quoting via -- is important
  // so mcp-proxy doesn't try to parse the inner command's flags.
  const child = spawn(
    "npx",
    [
      "-y",
      "mcp-proxy",
      "--port",
      String(port),
      "--",
      "npx",
      "-y",
      "@notionhq/notion-mcp-server",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, NOTION_TOKEN: token },
    },
  );

  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);

  child.on("exit", (code, signal) => {
    if (signal) {
      output.write(`\nmcp-proxy terminated by ${signal}.\n`);
    } else {
      output.write(`\nmcp-proxy exited with code ${code ?? 0}.\n`);
    }
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    output.write(
      `\nFailed to spawn mcp-proxy: ${err.message}\n` +
        `Make sure 'npx' is on your PATH. mcp-proxy and @notionhq/notion-mcp-server\n` +
        `are downloaded via npx on first run — no manual install needed.\n`,
    );
    process.exit(1);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
