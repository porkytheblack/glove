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
  bearer,
  connectMcp,
  mountMcp,
  type McpAdapter,
  type McpCatalogueEntry,
} from "glove-mcp";

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
  async getAccessToken(_id: string) {
    const t = process.env.NOTION_TOKEN;
    if (!t) {
      throw new Error(
        "NOTION_TOKEN is not set. See examples/mcp-cli/README.md for setup.",
      );
    }
    return t;
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
      url: process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
      tags: ["docs", "knowledge-base"],
    },
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Preflight: verify the token works before dropping into the REPL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function preflight(entry: McpCatalogueEntry, token: string) {
  const conn = await connectMcp({
    namespace: entry.id,
    url: entry.url,
    auth: bearer(token),
    clientInfo: { name: "glove-notion-agent", version: "1.0.0" },
  });
  const tools = await conn.listTools();
  await conn.close();
  return tools.map((t) => t.name);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const conversationId = process.argv[2] ?? "notion-default";

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    output.write(
      "\nNOTION_TOKEN is not set.\n" +
        "Copy examples/mcp-cli/.env.example to .env and fill in your token.\n" +
        "See examples/mcp-cli/README.md for the full setup walkthrough.\n\n",
    );
    process.exit(1);
  }

  const entries = notionEntries();
  const entry = entries[0];

  output.write(`Connecting to Notion MCP at ${entry.url}...\n`);
  let toolNames: string[];
  try {
    toolNames = await preflight(entry, token);
  } catch (err) {
    output.write(
      `\nFailed to connect to Notion MCP.\n${err instanceof Error ? err.message : String(err)}\n` +
        `\nDouble-check NOTION_TOKEN and NOTION_MCP_URL. See README for help.\n\n`,
    );
    process.exit(1);
  }
  output.write(
    `Connected. ${toolNames.length} Notion tools available: ${toolNames.slice(0, 6).join(", ")}` +
      `${toolNames.length > 6 ? `, +${toolNames.length - 6} more` : ""}\n\n`,
  );

  const glove = new Glove({
    store: new MemoryStore(conversationId),
    model: new AnthropicAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
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

  const adapter = new InMemoryMcpAdapter(conversationId);
  // Pre-activate Notion so mountMcp's reload step folds the tools immediately.
  await adapter.activate("notion");

  await mountMcp(glove, {
    adapter,
    entries,
    ambiguityPolicy: { type: "auto-pick-best" },
    clientInfo: { name: "glove-notion-agent", version: "1.0.0" },
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
