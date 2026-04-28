import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), ".env"),
});

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  Glove,
  Displaymanager,
  OpenRouterAdapter,
  type Message,
  type StoreAdapter,
} from "glove-core";
import {
  bearer,
  connectMcp,
  mountMcp,
  type McpAdapter,
  type McpCatalogueEntry,
} from "glove-mcp";

import { FsOAuthStore } from "glove-mcp/oauth";

import { FsTokenStore } from "./lib/token-store";

const MCP_CLIENT_INFO = { name: "Glove MCP CLI", version: "0.1.0" };

const MCP_OAUTH_STORE = new FsOAuthStore(
  join(dirname(fileURLToPath(import.meta.url)), ".mcp-oauth.json"),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Stores
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MemoryStore implements StoreAdapter {
  identifier: string;
  private messages: Array<Message> = [];
  private tokenCount = 0;
  private turnCount = 0;
  constructor(id: string) {
    this.identifier = id;
  }
  async getMessages() {
    return this.messages;
  }
  async appendMessages(msgs: Array<Message>) {
    this.messages.push(...msgs);
  }
  async getTokenCount() {
    return this.tokenCount;
  }
  async addTokens(count: number) {
    this.tokenCount += count;
  }
  async getTurnCount() {
    return this.turnCount;
  }
  async incrementTurn() {
    this.turnCount++;
  }
  async resetCounters() {
    this.tokenCount = 0;
    this.turnCount = 0;
  }
}

class InMemoryMcpAdapter implements McpAdapter {
  identifier: string;
  private active = new Set<string>();
  constructor(
    id: string,
    private readonly tokenStore: FsTokenStore,
  ) {
    this.identifier = id;
  }
  async getActive() {
    return [...this.active];
  }
  async activate(id: string) {
    this.active.add(id);
  }
  async deactivate(id: string) {
    this.active.delete(id);
  }

  async getAccessToken(id: string) {
    // 1. MCP OAuth-acquired access token (`pnpm mcp:notion-mcp-auth`).
    const oauthState = await MCP_OAUTH_STORE.get(id);
    if (oauthState.tokens?.access_token) return oauthState.tokens.access_token;

    // 2. Env var override — internal integration tokens, CI runs.
    const envToken = process.env[`${id.toUpperCase()}_TOKEN`];
    if (envToken) return envToken;

    // 3. api.notion.com OAuth token from the self-hosted path (`pnpm mcp:notion-auth`).
    const stored = await this.tokenStore.get(id);
    if (stored?.access_token) return stored.access_token;

    throw new Error(
      `No access token for "${id}". Run \`pnpm mcp:notion-mcp-auth\` (recommended), ` +
        `\`pnpm mcp:notion-auth\` (self-hosted path), or set ${id.toUpperCase()}_TOKEN ` +
        `in examples/mcp-cli/.env.`,
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notion catalogue (single entry)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function notionEntries(): McpCatalogueEntry[] {
  return [
    {
      id: "notion",
      name: "Notion",
      description:
        "Read and write Notion pages, databases, comments, and blocks.",
      // Default targets Notion's hosted MCP — the same endpoint Claude Code
      // uses. Requires running `pnpm mcp:notion-mcp-auth` first to do the
      // MCP-spec OAuth dance (DCR + PKCE). Override to a local URL if you
      // prefer the self-hosted notion-mcp-server path.
      url: process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
      tags: ["docs", "knowledge-base"],
    },
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Preflight: verify the credentials work before dropping into the REPL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function preflight(entry: McpCatalogueEntry, adapter: McpAdapter) {
  const conn = await connectMcp({
    namespace: entry.id,
    url: entry.url,
    auth: bearer(() => adapter.getAccessToken(entry.id)),
    clientInfo: MCP_CLIENT_INFO,
  });
  const tools = await conn.listTools();
  await conn.close();
  return { toolNames: tools.map((t) => t.name) };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const conversationId = process.argv[2] ?? "notion-default";

  const tokenStore = new FsTokenStore(
    join(dirname(fileURLToPath(import.meta.url)), ".notion-token.json"),
  );
  const adapter = new InMemoryMcpAdapter(conversationId, tokenStore);

  const entries = notionEntries();
  const entry = entries[0];

  output.write(`Connecting to Notion MCP at ${entry.url}...\n`);
  let toolNames: string[];
  try {
    ({ toolNames } = await preflight(entry, adapter));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    output.write(`\nFailed to connect to Notion MCP.\n${message}\n\n`);

    if (
      lower.includes("no access token") ||
      lower.includes("needs re-authorization")
    ) {
      output.write(
        `Run the OAuth flow first:\n\n` +
          `  pnpm mcp:notion-mcp-auth        # MCP-spec OAuth (recommended, hits ${entry.url})\n` +
          `  pnpm mcp:notion-auth            # api.notion.com OAuth (for self-hosted path)\n\n`,
      );
    } else if (
      lower.includes("econnrefused") ||
      lower.includes("connect failed") ||
      lower.includes("fetch failed")
    ) {
      output.write(
        `Looks like nothing is listening at ${entry.url}.\n` +
          (entry.url.includes("localhost")
            ? `Start the local Notion MCP server in another terminal:\n\n  pnpm mcp:notion-server\n\n`
            : `Check your network or NOTION_MCP_URL.\n\n`),
      );
    } else if (
      lower.includes("401") ||
      lower.includes("unauthorized") ||
      lower.includes("invalid token") ||
      lower.includes("invalid_token")
    ) {
      output.write(
        `The MCP server rejected the credentials. Common causes:\n\n` +
          `  · You're hitting ${entry.url} with an api.notion.com OAuth token —\n` +
          `    different audience. Run \`pnpm mcp:notion-mcp-auth\` to do the\n` +
          `    proper MCP-spec OAuth dance.\n` +
          `  · Token expired and refresh failed — same fix.\n\n`,
      );
    } else {
      output.write(`See examples/mcp-cli/README.md for the full setup walkthrough.\n\n`);
    }
    process.exit(1);
  }

  const stored = await tokenStore.get("notion");
  const workspace =
    typeof stored?.meta?.workspace_name === "string"
      ? (stored.meta.workspace_name as string)
      : null;
  output.write(
    `Connected${workspace ? ` to workspace "${workspace}"` : ""}. ` +
      `${toolNames.length} Notion tools available: ${toolNames.slice(0, 6).join(", ")}` +
      `${toolNames.length > 6 ? `, +${toolNames.length - 6} more` : ""}\n\n`,
  );

  const glove = new Glove({
    store: new MemoryStore(conversationId),
    model: new OpenRouterAdapter({
      // OpenRouterAdapter auto-reads OPENROUTER_API_KEY from process.env
      // when apiKey is omitted.
      model: process.env.ANTHROPIC_MODEL ?? "anthropic/claude-sonnet-4.5",
      stream: true,
    }),
    displayManager: new Displaymanager(),
    systemPrompt:
      "You are a Notion-savvy assistant. The user's Notion workspace is " +
      "available via the notion__* tools. Prefer reading before writing, and " +
      "confirm before destructive actions.",
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarise the conversation, preserving page ids, database ids, and decisions.",
    },
  });

  // Pre-activate Notion so mountMcp's reload step folds the tools immediately.
  await adapter.activate("notion");

  await mountMcp(glove, {
    adapter,
    entries,
    ambiguityPolicy: { type: "auto-pick-best" },
    clientInfo: MCP_CLIENT_INFO,
  });

  glove.build();

  glove.addSubscriber({
    async record(type, data) {
      if (type === "text_delta") output.write((data as { text: string }).text);
      if (type === "model_response_complete") output.write("\n");
      if (type === "tool_use")
        output.write(`\n[calling ${(data as { name: string }).name}]\n`);
      if (type === "tool_use_result") {
        const r = data as { result: { status: string; message?: string } };
        if (r.result.status === "error") {
          output.write(
            `\n[tool error: ${r.result.message ?? "unknown"}]\n`,
          );
        }
      }
    },
  });

  output.write("Notion agent ready. Type your message, or '/exit' to quit.\n");
  const rl = createInterface({ input, output });
  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) continue;
    if (line === "/exit") break;
    await glove.processRequest(line);
  }
  rl.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
