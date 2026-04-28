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
  type OAuthClientProvider,
} from "glove-mcp";

import {
  buildClientMetadata,
  findStoredOAuthProvider,
  FsOAuthStore,
} from "glove-mcp/oauth";

const MCP_CLIENT_INFO = { name: "Glove MCP CLI", version: "0.1.0" };

const MCP_OAUTH_STORE = new FsOAuthStore(
  join(dirname(fileURLToPath(import.meta.url)), ".mcp-oauth.json"),
);

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

function authRedirectUrl(): string {
  if (process.env.GMAIL_OAUTH_REDIRECT_URI)
    return process.env.GMAIL_OAUTH_REDIRECT_URI;
  const port = process.env.GMAIL_OAUTH_PORT ?? "53684";
  return `http://localhost:${port}/callback`;
}

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
    if (id !== "gmail") return undefined;

    const redirectUrl = authRedirectUrl();
    return findStoredOAuthProvider(MCP_OAUTH_STORE, id, {
      redirectUrl,
      clientMetadata: buildClientMetadata({
        redirectUrl,
        scope: GMAIL_SCOPES,
        tokenEndpointAuthMethod: "client_secret_basic",
      }),
      onAuthorizeUrl: () => {
        throw new Error(
          `MCP OAuth session for "${id}" needs re-authorization. ` +
            `Run \`pnpm mcp:gmail-auth\` to re-grant access.`,
        );
      },
    });
  }

  async getAccessToken(id: string): Promise<string> {
    throw new Error(
      `No access token for "${id}". Run \`pnpm mcp:gmail-auth\` to grant access.`,
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Catalogue (single entry — gmail)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function gmailEntries(): McpCatalogueEntry[] {
  return [
    {
      id: "gmail",
      name: "Gmail",
      description:
        "Search emails and threads, read messages, list/apply/remove labels, " +
        "and create draft emails.",
      url: process.env.GMAIL_MCP_URL ?? "https://gmailmcp.googleapis.com/mcp/v1",
      tags: ["email", "communications"],
    },
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Preflight
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function preflight(entry: McpCatalogueEntry, adapter: McpAdapter) {
  const authProvider = (await adapter.getAuthProvider?.(entry.id)) ?? undefined;
  const conn = await connectMcp({
    namespace: entry.id,
    url: entry.url,
    authProvider,
    auth: authProvider
      ? undefined
      : bearer(() => adapter.getAccessToken(entry.id)),
    clientInfo: MCP_CLIENT_INFO,
  });
  const tools = await conn.listTools();
  await conn.close();
  return tools.map((t) => t.name);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const conversationId = process.argv[2] ?? "gmail-default";

  const adapter = new InMemoryMcpAdapter(conversationId);
  const entries = gmailEntries();
  const entry = entries[0];

  output.write(`Connecting to Gmail MCP at ${entry.url}...\n`);
  let toolNames: string[];
  try {
    toolNames = await preflight(entry, adapter);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    output.write(`\nFailed to connect to Gmail MCP.\n${message}\n\n`);

    if (lower.includes("no access token") || lower.includes("needs re-authorization")) {
      output.write(`Run the OAuth flow first:\n\n  pnpm mcp:gmail-auth\n\n`);
    } else if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid_token")) {
      output.write(
        `The MCP server rejected the credentials. Token may have expired —\n` +
          `re-run \`pnpm mcp:gmail-auth\` to refresh.\n\n`,
      );
    } else {
      output.write(`See examples/mcp-cli/README.md for the Gmail setup walkthrough.\n\n`);
    }
    process.exit(1);
  }

  output.write(
    `Connected. ${toolNames.length} Gmail tools available: ${toolNames.slice(0, 6).join(", ")}` +
      `${toolNames.length > 6 ? `, +${toolNames.length - 6} more` : ""}\n\n`,
  );

  const glove = new Glove({
    store: new MemoryStore(conversationId),
    model: new OpenRouterAdapter({
      model: process.env.ANTHROPIC_MODEL ?? "anthropic/claude-sonnet-4.5",
      stream: true,
    }),
    displayManager: new Displaymanager(),
    systemPrompt:
      "You are an email-savvy assistant. The user's Gmail is available via " +
      "the gmail__* tools. Capabilities are limited to readonly + compose — " +
      "you can search, read, label, and create drafts. You CANNOT send mail " +
      "directly; always create a draft and tell the user to review and send. " +
      "Cite message ids and thread ids when referencing specific emails.",
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarise the conversation, preserving message ids, thread ids, label ids, and decisions.",
    },
  });

  await adapter.activate("gmail");

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
          output.write(`\n[tool error: ${r.result.message ?? "unknown"}]\n`);
        }
      }
    },
  });

  output.write("Gmail agent ready. Type your message, or '/exit' to quit.\n");
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
