import { defineMcp } from "glove-foundry";

const projectTracker = defineMcp({
  description: "Example external project-tracking MCP server",
  entry: {
    name: "Project Tracker",
    description: "Example external project-tracking MCP server",
    url: "https://example.invalid/mcp",
    tags: ["projects", "issues"],
  },
});

export default projectTracker;
