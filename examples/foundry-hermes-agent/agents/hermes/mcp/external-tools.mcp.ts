import { defineMcp } from "glove-foundry";

const externalTools = defineMcp({
  description: "A consumer-selected external MCP server; deliberately inert until installed",
  entry: {
    name: "External tools",
    description: "Consumer-provided MCP endpoint for extra capabilities",
    url: "https://example.invalid/mcp",
    tags: ["optional", "consumer-owned"],
    excludeTools: ["delete_repository", "drop_database"],
  },
});

export default externalTools;
