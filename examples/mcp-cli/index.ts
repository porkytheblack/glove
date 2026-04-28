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
import { mountMcp, type McpAdapter } from "glove-mcp";

import { entries } from "./shared/mcp-config";
import { FsTokenStore } from "./lib/token-store";
import { FsOAuthStore } from "glove-mcp/oauth";

const MCP_CLIENT_INFO = { name: "Glove MCP CLI", version: "0.1.0" };

const TOKEN_STORE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  ".notion-token.json",
);
const MCP_OAUTH_STORE = new FsOAuthStore(
  join(dirname(fileURLToPath(import.meta.url)), ".mcp-oauth.json"),
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory store
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// In-memory MCP adapter
//
// Activation state is held in process; replace with a SQLite/Redis-backed
// implementation for production use. Tokens come from the environment.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class InMemoryMcpAdapter implements McpAdapter {
  identifier: string;
  private active = new Set<string>();
  private tokenStore = new FsTokenStore(TOKEN_STORE_PATH);

  constructor(id: string) {
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
    // 1. MCP-spec OAuth access token from `pnpm mcp:notion-mcp-auth` /
    //    `pnpm mcp:gmail-auth`. The acquired access_token IS the bearer token.
    const oauthState = await MCP_OAUTH_STORE.get(id);
    if (oauthState.tokens?.access_token) return oauthState.tokens.access_token;

    // 2. Env var override (internal integration tokens, CI runs).
    const envToken = process.env[`${id.toUpperCase()}_TOKEN`];
    if (envToken) return envToken;

    // 3. api.notion.com OAuth token from the self-hosted path
    //    (`pnpm mcp:notion-auth` + `pnpm mcp:notion-server`).
    const stored = await this.tokenStore.get(id);
    if (stored?.access_token) return stored.access_token;

    const authCommand =
      id === "gmail" ? "pnpm mcp:gmail-auth" : "pnpm mcp:notion-mcp-auth";
    throw new Error(
      `No token configured for "${id}". Run \`${authCommand}\`, ` +
        `or set ${id.toUpperCase()}_TOKEN in examples/mcp-cli/.env.`,
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const conversationId = process.argv[2] ?? "default";

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
      "You are a helpful assistant.\n\n" +
      "When the user asks for something requiring an external integration " +
      "(Notion, Linear, etc), call find_capability to discover and activate " +
      "the right MCP server. Once activated, its tools are available on your " +
      "next turn.",
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarise the conversation, preserving decisions and active capabilities.",
    },
  });

  const adapter = new InMemoryMcpAdapter(conversationId);

  await mountMcp(glove, {
    adapter,
    entries,
    ambiguityPolicy: { type: "defer-to-main" },
    clientInfo: MCP_CLIENT_INFO,
  });

  glove.build();

  glove.addSubscriber({
    async record(type, data) {
      if (type === "text_delta") output.write((data as { text: string }).text);
      if (type === "model_response_complete") output.write("\n");
      if (type === "tool_use")
        output.write(`\n[calling ${(data as { name: string }).name}]\n`);
    },
  });

  const rl = createInterface({ input, output });
  output.write(
    "MCP CLI ready. Type your message, or '/exit' to quit.\n",
  );
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
