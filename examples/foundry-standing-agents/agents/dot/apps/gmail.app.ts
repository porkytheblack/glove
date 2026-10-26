import { defineApp } from "glove-foundry";
import { z } from "zod";
import { askUnlessAllowed, mcpCredentials, mcpServer } from "../../../lib/mcp-servers.js";
import gmailWatch from "../connections/gmail-watch.connection.js";
import { readOnly } from "../research.js";
import gmail from "../transmissions/gmail.transmission.js";

/** The mailbox's reads, for servers that don't mark them. */
export const GMAIL_READS: ReadonlyArray<string> = ["search_threads", "get_thread", "get_message", "list_drafts", "list_labels"];
const reads = GMAIL_READS;
const policy = askUnlessAllowed([...reads, "create_draft"]);

/**
 * Gmail, connected to the mailbox a dot works from: its person's, or a
 * specialist's own. One app holds everything about it:
 *
 * - reading, searching and drafting come from Google's Gmail MCP server,
 *   opened with the installation's account;
 * - sending is the Gmail transmission's outbound side, delivered by Foundry;
 *   the dot puts its auto-review around it (agent.ts);
 * - new mail arrives through the gmail-watch connection.
 *
 * On runs the dot starts itself (research, new mail), only the reads mount.
 */
export default defineApp({
  description: "Gmail: search, read and draft mail, send under the dot's rules, and hear about new mail",
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
    tools: (tool, ctx) => (readOnly(ctx.request) && !tool.readOnly && !reads.includes(tool.name) ? "hide" : policy(tool, ctx)),
  },
});
