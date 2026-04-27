import type { McpCatalogueEntry } from "glove-mcp";

export const entries: McpCatalogueEntry[] = [
  {
    id: "notion",
    name: "Notion",
    description:
      "Read and write Notion pages, databases, comments, and blocks.",
    // Defaults to Notion's hosted MCP — use `pnpm mcp:notion-mcp-auth` to
    // run the MCP-spec OAuth flow (DCR + PKCE). Override to a local URL
    // (e.g. http://localhost:3030/mcp) if you prefer the self-hosted
    // notion-mcp-server path.
    url: process.env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
    tags: ["docs", "knowledge-base"],
  },
  {
    id: "linear",
    name: "Linear",
    description:
      "Create and update issues, projects, cycles, and milestones.",
    url: "https://mcp.linear.app/mcp",
    tags: ["issues", "tickets"],
  },
];
