import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "glove-mcp-stdio-fixture", version: "1.0.0" });

server.registerTool("echo", {
  description: "Echo a value with an adapter-owned environment prefix.",
  inputSchema: z.object({ value: z.string() }),
}, ({ value }) => ({
  content: [{ type: "text", text: `${process.env.GLOVE_MCP_FIXTURE_PREFIX ?? "missing"}:${value}` }],
}));

server.registerTool("wait", {
  description: "Wait before replying so request timeout behavior can be verified.",
  inputSchema: z.object({ milliseconds: z.number().int().min(0) }),
}, async ({ milliseconds }) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  return { content: [{ type: "text", text: "finished" }] };
});

let lateToolInstalled = false;
server.registerTool("install_late_tool", {
  description: "Install a tool after initialization to emit tools/list_changed.",
  inputSchema: z.object({}),
}, () => {
  if (!lateToolInstalled) {
    lateToolInstalled = true;
    server.registerTool("late_tool", {
      description: "A dynamically installed fixture tool.",
      inputSchema: z.object({}),
    }, () => ({ content: [{ type: "text", text: "late:ready" }] }));
  }
  return { content: [{ type: "text", text: "installed" }] };
});

server.registerResource("brief", "file:///brief.txt", {
  title: "Project brief",
  description: "A fixture resource",
  mimeType: "text/plain",
}, async () => ({
  contents: [{
    uri: "file:///brief.txt",
    text: `resource\u{E0061}:ready`,
    _meta: {
      "vendor.example/checksum": "fixture",
      "io.modelcontextprotocol/related-task": { taskId: "hidden" },
    },
  }],
  _meta: { "vendor.example/page": "resource-list" },
}));

server.registerPrompt("summarize", {
  description: "Summarize a topic",
  argsSchema: { topic: z.string() },
}, async ({ topic }) => ({
  messages: [{
    role: "user",
    content: { type: "text", text: `Summarize ${topic}\u{E0061}.` },
  }],
  _meta: { "vendor.example/prompt": "fixture" },
}));

await server.connect(new StdioServerTransport());
