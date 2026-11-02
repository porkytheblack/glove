import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// A stand-in for Linear's MCP server, with the same tool names. Issues filed
// here are written to the example's ledger, where `pnpm verify` checks them.

const dataDir = process.env.DEMO_DATA_DIR ?? ".";
const ledger = join(dataDir, "ledger.jsonl");

interface Issue { readonly id: string; readonly title: string; readonly description?: string; readonly team: string; readonly state: string }

async function issues(): Promise<Issue[]> {
  try {
    return (await readFile(ledger, "utf8")).trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string } & Issue)
      .filter((entry) => entry.kind === "ticket");
  } catch {
    return [];
  }
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const read = { readOnlyHint: true } as const;
const server = new McpServer({ name: "linear-offline", version: "1.0.0" }, { instructions: "Linear, offline sample workspace." });

server.registerTool("list_teams", { description: "List teams.", inputSchema: {}, annotations: read },
  () => text({ teams: [{ key: "ENG", name: "Engineering" }] }));

server.registerTool("list_issues", {
  description: "List issues, optionally matching a query.",
  inputSchema: { query: z.string().optional() },
  annotations: read,
}, async ({ query }) => text({
  issues: (await issues()).filter((issue) => !query || issue.title.toLowerCase().includes(query.toLowerCase())),
}));

server.registerTool("get_issue", { description: "Read one issue.", inputSchema: { id: z.string() }, annotations: read },
  async ({ id }) => text((await issues()).find((issue) => issue.id === id) ?? { error: `No issue ${id}` }));

server.registerTool("save_issue", {
  description: "Create an issue, or update one when id is given.",
  inputSchema: { id: z.string().optional(), title: z.string(), description: z.string().optional(), team: z.string().default("ENG") },
}, async ({ id, title, description, team }) => {
  const issue: Issue = { id: id ?? `${team}-${(await issues()).length + 1}`, title, team, state: "Todo", ...(description ? { description } : {}) };
  await mkdir(dataDir, { recursive: true });
  await appendFile(ledger, `${JSON.stringify({ kind: "ticket", ...issue, at: new Date().toISOString() })}\n`);
  return text({ issue });
});

await server.connect(new StdioServerTransport());
