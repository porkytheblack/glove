import { defineApp } from "glove-foundry";
import { z } from "zod";
import { askUnlessAllowed, mcpCredentials, mcpServer } from "../../../lib/mcp-servers.js";

/**
 * Linear, connected to a person's workspace. Linear's hosted MCP server is
 * the whole app: the installation's account opens it, reads run, and filing
 * or changing an issue asks first unless the person chose "Always allow".
 * Most apps look like this one; add a transmission when the provider also
 * pushes events or a send must be delivered outside the agent.
 */
export default defineApp({
  description: "Linear: find, file and update issues",
  config: z.object({
    /** Tools the person chose "Always allow" for. */
    alwaysAllow: z.array(z.string()).default([]),
    /** Tools that always ask, even if always allowed: require-approval rules win. */
    alwaysAsk: z.array(z.string()).default([]),
  }),
  mcp: {
    entry: mcpServer("linear"),
    auth: mcpCredentials(),
    tools: askUnlessAllowed(["list_issues", "get_issue", "list_teams", "list_projects", "list_comments"]),
  },
});
