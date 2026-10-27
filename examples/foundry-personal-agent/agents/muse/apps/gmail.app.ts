import { defineApp } from "glove-foundry";
import { z } from "zod";
import { byAccess, mcpCredentials, mcpServer } from "../../../lib/mcp-servers.js";
import gmailWatch from "../connections/gmail-watch.connection.js";
import gmail from "../transmissions/gmail.transmission.js";

/**
 * Gmail, connected to the person's account, with the access they chose:
 *
 * - "read": Muse searches and reads through Google's Gmail MCP server, and
 *   nothing else is there;
 * - "act": it can also draft, and send through the Gmail transmission, which
 *   Foundry delivers after the person approves the exact email.
 *
 * New mail arrives through the gmail-watch connection either way. Install it
 * with an account: `{ kind: "application", id: "gmail", accountId, config: { access } }`.
 */
export default defineApp({
  description: "Gmail: read mail, and with the person's say-so draft and send it; hear about new mail",
  config: z.object({
    access: z.enum(["read", "act"]).default("read"),
    /** Tools the person chose "Always allow" for. */
    alwaysAllow: z.array(z.string()).default([]),
  }),
  inbound: [gmail],
  outbound: [gmail],
  connections: [gmailWatch],
  mcp: {
    entry: mcpServer("gmail"),
    auth: mcpCredentials(),
    tools: byAccess({ reads: ["search_threads", "get_thread", "get_message", "list_drafts", "list_labels"], free: ["create_draft"] }),
  },
});
