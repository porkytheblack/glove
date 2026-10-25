import { defineApp } from "glove-foundry";
import { z } from "zod";
import { askUnlessAllowed, mcpCredentials, mcpServer } from "../../../lib/mcp-servers.js";
import gmailWatch from "../connections/gmail-watch.connection.js";
import gmail from "../transmissions/gmail.transmission.js";

/**
 * Gmail, connected to a person's account. One app holds everything about it:
 *
 * - reading, searching and drafting come from Google's Gmail MCP server,
 *   opened with the installation's account;
 * - sending is the Gmail transmission's outbound side, delivered by Foundry
 *   after the person approves the exact email (Google's server has no send);
 * - new mail arrives through the gmail-watch connection.
 *
 * Install it with an account: `install(gmailApp, config, { account })`, or
 * `{ kind: "application", id: "gmail", accountId }` over HTTP.
 */
export default defineApp({
  description: "Gmail: search, read and draft mail, send with approval, and hear about new mail",
  config: z.object({
    /** Tools the person chose "Always allow" for. */
    alwaysAllow: z.array(z.string()).default([]),
  }),
  inbound: [gmail],
  outbound: [gmail],
  connections: [gmailWatch],
  mcp: {
    entry: mcpServer("gmail"),
    auth: mcpCredentials(),
    // Drafting sends nothing, so it runs; label changes ask.
    tools: askUnlessAllowed(["search_threads", "get_thread", "get_message", "list_drafts", "list_labels", "create_draft"]),
  },
});
