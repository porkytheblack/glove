import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// A mail server for app-backed MCP tests. MAIL_TOKEN comes from the
// installation's account session, so a reply that names it proves the
// credential reached the connection and nothing else.
const server = new McpServer({ name: "foundry-mail-fixture", version: "1.0.0" });

server.registerTool("search_mail", {
  description: "Search the mailbox.",
  inputSchema: { query: z.string() },
  annotations: { readOnlyHint: true },
}, ({ query }) => ({
  content: [{
    type: "text",
    text: JSON.stringify({ token: process.env.MAIL_TOKEN ?? "missing", query, messages: [{ id: "m1", subject: "Invoice" }] }),
  }],
}));

server.registerTool("send_mail", {
  description: "Send an email.",
  inputSchema: { to: z.string(), body: z.string() },
}, ({ to }) => ({ content: [{ type: "text", text: `sent to ${to}` }] }));

server.registerTool("delete_mail", {
  description: "Delete a message.",
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
}, ({ id }) => ({ content: [{ type: "text", text: `deleted ${id}` }] }));

await server.connect(new StdioServerTransport());
