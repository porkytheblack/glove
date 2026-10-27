import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sampleMailbox, type SampleMessage } from "./mailbox.js";

// A stand-in for Google's Gmail MCP server, with the same tool names, over
// the sample mailbox. The Gmail app starts it for sample accounts. Nothing
// here can send.

const account = process.env.DEMO_ACCOUNT ?? "you@example.com";
const dataDir = process.env.DEMO_DATA_DIR ?? ".";
const draftsFile = join(dataDir, `gmail-drafts-${account}.json`);

async function drafts(): Promise<Array<Record<string, string>>> {
  try { return JSON.parse(await readFile(draftsFile, "utf8")); } catch { return []; }
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const summary = ({ body: _body, ...message }: SampleMessage) => message;
const read = { readOnlyHint: true } as const;
const server = new McpServer({ name: "gmail-offline", version: "1.0.0" }, { instructions: `Gmail for ${account}, offline sample data.` });

server.registerTool("search_threads", {
  description: "Search threads with Gmail search syntax, like in:inbox, subject:invoice or from:priya.",
  inputSchema: { query: z.string(), maxResults: z.number().int().min(1).max(50).optional() },
  annotations: read,
}, async ({ query, maxResults }) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).map((term) => term.replace(/^(subject|from|in|label):/, ""));
  const threads = (await sampleMailbox(dataDir, account))
    .filter((message) => terms.every((term) => `${message.subject} ${message.from} ${message.body} ${message.labels.join(" ")}`.toLowerCase().includes(term)))
    .slice(0, maxResults ?? 20)
    .map((message) => ({ threadId: message.threadId, snippet: message.body.slice(0, 100), latest: summary(message) }));
  return text({ threads });
});

server.registerTool("get_thread", { description: "Read every message in a thread.", inputSchema: { threadId: z.string() }, annotations: read },
  async ({ threadId }) => text({ threadId, messages: (await sampleMailbox(dataDir, account)).filter((message) => message.threadId === threadId) }));

server.registerTool("get_message", { description: "Read one message.", inputSchema: { messageId: z.string() }, annotations: read },
  async ({ messageId }) => text((await sampleMailbox(dataDir, account)).find((message) => message.id === messageId) ?? { error: `No message ${messageId}` }));

server.registerTool("list_labels", { description: "List the mailbox's labels.", inputSchema: {}, annotations: read },
  () => text({ labels: ["INBOX", "UNREAD", "STARRED", "IMPORTANT"] }));

server.registerTool("list_drafts", { description: "List drafts.", inputSchema: {}, annotations: read },
  async () => text({ drafts: await drafts() }));

server.registerTool("create_draft", {
  description: "Save a draft. Nothing is sent.",
  inputSchema: { to: z.string(), subject: z.string(), body: z.string(), threadId: z.string().optional() },
}, async (draft) => {
  const saved = { id: `d-${Date.now().toString(36)}`, ...draft };
  await mkdir(dataDir, { recursive: true });
  await writeFile(draftsFile, JSON.stringify([...(await drafts()), saved], null, 2));
  return text(saved);
});

server.registerTool("label_thread", {
  description: "Add labels to a thread.",
  inputSchema: { threadId: z.string(), labelIds: z.array(z.string()) },
}, ({ threadId, labelIds }) => text({ threadId, added: labelIds }));

await server.connect(new StdioServerTransport());
