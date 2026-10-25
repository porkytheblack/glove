import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// A stand-in for Google's Gmail MCP server, with the same tool names, over a
// sample mailbox. The Gmail app starts it when no Google OAuth client is
// configured. DEMO_ACCOUNT is the connected address; nothing here can send.

const account = process.env.DEMO_ACCOUNT ?? "you@example.com";
const dataDir = process.env.DEMO_DATA_DIR ?? ".";
const draftsFile = join(dataDir, `gmail-drafts-${account}.json`);

interface Message { readonly id: string; readonly threadId: string; readonly from: string; readonly to: string; readonly subject: string; readonly body: string; readonly date: string; readonly labels: ReadonlyArray<string> }

const mailbox: ReadonlyArray<Message> = [
  { id: "m-101", threadId: "t-101", from: "Signups <signups@app.example.com>", to: account, subject: "New signup: Dana Lee (Northwind)", body: "Dana Lee, dana@example.com, Head of Data at Northwind. Signed up 2026-10-20.", date: "2026-10-20T09:12:00Z", labels: ["INBOX"] },
  { id: "m-102", threadId: "t-102", from: "Signups <signups@app.example.com>", to: account, subject: "New signup: Ravi Patel (Globex)", body: "Ravi Patel, ravi@example.com, Analytics lead at Globex. Signed up 2026-10-22.", date: "2026-10-22T15:40:00Z", labels: ["INBOX"] },
  { id: "m-103", threadId: "t-103", from: "Lena Park <lena@northwind.example>", to: account, subject: "Export API pricing?", body: "Hi, what does the export API cost for a team of 40? We'd like to start next month.", date: "2026-10-24T08:05:00Z", labels: ["INBOX", "UNREAD"] },
];

async function drafts(): Promise<Array<Record<string, string>>> {
  try { return JSON.parse(await readFile(draftsFile, "utf8")); } catch { return []; }
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const summary = ({ body: _body, ...message }: Message) => message;
const read = { readOnlyHint: true } as const;

const server = new McpServer({ name: "gmail-offline", version: "1.0.0" }, {
  instructions: `Gmail for ${account}, offline sample data.`,
});

server.registerTool("search_threads", {
  description: "Search threads with Gmail search syntax, like subject:signup or from:lena.",
  inputSchema: { query: z.string(), maxResults: z.number().int().min(1).max(50).optional() },
  annotations: read,
}, ({ query, maxResults }) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).map((term) => term.replace(/^(subject|from|in|label):/, ""));
  const threads = mailbox
    .filter((message) => terms.every((term) => `${message.subject} ${message.from} ${message.body} ${message.labels.join(" ")}`.toLowerCase().includes(term)))
    .slice(0, maxResults ?? 20)
    .map((message) => ({ threadId: message.threadId, snippet: message.body.slice(0, 80), latest: summary(message) }));
  return text({ threads });
});

server.registerTool("get_thread", {
  description: "Read every message in a thread.",
  inputSchema: { threadId: z.string() },
  annotations: read,
}, ({ threadId }) => text({ threadId, messages: mailbox.filter((message) => message.threadId === threadId) }));

server.registerTool("get_message", {
  description: "Read one message.",
  inputSchema: { messageId: z.string() },
  annotations: read,
}, ({ messageId }) => text(mailbox.find((message) => message.id === messageId) ?? { error: `No message ${messageId}` }));

server.registerTool("list_labels", {
  description: "List the mailbox's labels.",
  inputSchema: {},
  annotations: read,
}, () => text({ labels: ["INBOX", "UNREAD", "STARRED", "IMPORTANT"] }));

server.registerTool("list_drafts", {
  description: "List drafts.",
  inputSchema: {},
  annotations: read,
}, async () => text({ drafts: await drafts() }));

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
