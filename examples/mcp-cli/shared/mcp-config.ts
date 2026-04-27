import type { McpCatalogueEntry } from "glove-mcp";

export const entries: McpCatalogueEntry[] = [
  {
    id: "notion",
    name: "Notion",
    description:
      "Read and write Notion pages, databases, comments, and blocks.",
    // Defaults to the local mcp-proxy + @notionhq/notion-mcp-server you start
    // with `pnpm mcp:notion-server`. The hosted https://mcp.notion.com/mcp
    // uses a separate OAuth issuer and rejects api.notion.com tokens.
    url: process.env.NOTION_MCP_URL ?? "http://localhost:3030/mcp",
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
