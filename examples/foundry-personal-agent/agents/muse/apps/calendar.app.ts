import { defineApp } from "glove-foundry";
import { z } from "zod";
import { byAccess, mcpCredentials, mcpServer } from "../../../lib/mcp-servers.js";

/**
 * Google Calendar, connected to the person's account. Google's Calendar MCP
 * server is the whole app. With "read" access Muse sees the calendar and finds
 * times; with "act" it can also create, move and answer events, each asking
 * first unless the person always allows it.
 */
export default defineApp({
  description: "Google Calendar: see the person's days, and with their say-so change events",
  config: z.object({
    access: z.enum(["read", "act"]).default("read"),
    /** Tools the person chose "Always allow" for. */
    alwaysAllow: z.array(z.string()).default([]),
  }),
  mcp: {
    entry: mcpServer("calendar"),
    auth: mcpCredentials(),
    tools: byAccess({ reads: ["list_calendars", "list_events", "get_event", "search_events", "suggest_time"] }),
  },
});
