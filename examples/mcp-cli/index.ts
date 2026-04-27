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
  AnthropicAdapter,
  type Message,
  type StoreAdapter,
} from "glove-core";
import {
  mountMcp,
  type McpAdapter,
  type OAuthClientProvider,
} from "glove-mcp";

import { entries } from "./shared/mcp-config";
import { FsTokenStore } from "./lib/token-store";
import { FsMcpOAuthProvider } from "./lib/mcp-oauth";
import { MCP_CLIENT_INFO, buildClientMetadata } from "./lib/mcp-client-info";

const TOKEN_STORE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  ".notion-token.json",
);
const MCP_OAUTH_STORE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  ".mcp-oauth.json",
);

function authRedirectUrl(): string {
  if (process.env.NOTION_MCP_OAUTH_REDIRECT_URI)
    return process.env.NOTION_MCP_OAUTH_REDIRECT_URI;
  const port = process.env.NOTION_MCP_OAUTH_PORT ?? "53683";
  return `http://localhost:${port}/callback`;
}

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

  async getAuthProvider(id: string): Promise<OAuthClientProvider | undefined> {
    const redirectUrl = authRedirectUrl();
    const baseOpts = {
      redirectUrl,
      clientMetadata: buildClientMetadata(redirectUrl),
    };

    const probe = new FsMcpOAuthProvider(MCP_OAUTH_STORE_PATH, id, {
      ...baseOpts,
      onAuthorizeUrl: () => {},
    });
    const tokens = await probe.tokens();
    if (!tokens) return undefined;

    return new FsMcpOAuthProvider(MCP_OAUTH_STORE_PATH, id, {
      ...baseOpts,
      onAuthorizeUrl: () => {
        throw new Error(
          `MCP OAuth session for "${id}" needs re-authorization. ` +
            `Run \`pnpm mcp:notion-mcp-auth\` (or your provider's equivalent) to re-grant access.`,
        );
      },
    });
  }

  async getAccessToken(id: string) {
    // 1. Env var wins (internal integration tokens, CI overrides).
    const envToken = process.env[`${id.toUpperCase()}_TOKEN`];
    if (envToken) return envToken;

    // 2. OAuth-acquired token from `pnpm mcp:notion-auth` (Notion only today).
    const stored = await this.tokenStore.get(id);
    if (stored?.access_token) return stored.access_token;

    throw new Error(
      `No token configured for "${id}". Run \`pnpm mcp:notion-auth\` for Notion, ` +
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
    model: new AnthropicAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
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
