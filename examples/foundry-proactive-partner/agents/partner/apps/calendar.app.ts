import { defineApp } from "glove-foundry";
import { z } from "zod";
import { askUnlessAllowed, mcpCredentials, mcpServer } from "../../../lib/mcp-servers.js";

/**
 * Google Calendar, connected to the person's account. Google's Calendar MCP
 * server is the whole app: reading the day and finding times run; creating,
 * moving or answering an event asks first unless the person always allows it.
 */
export default defineApp({
  description: "Google Calendar: read the day, find times, and change events with approval",
  config: z.object({
    /** Tools the person chose "Always allow" for. */
    alwaysAllow: z.array(z.string()).default([]),
  }),
  mcp: {
    entry: mcpServer("calendar"),
    auth: mcpCredentials(),
    tools: askUnlessAllowed(["list_calendars", "list_events", "get_event", "search_events", "suggest_time"]),
  },
});
