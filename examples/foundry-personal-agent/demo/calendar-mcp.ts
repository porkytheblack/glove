import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// A stand-in for Google's Calendar MCP server, with the same tool names, over
// today's sample calendar in fixtures/. Changes are acknowledged, not kept.

interface SampleEvent { readonly id: string; readonly title: string; readonly start: string; readonly end: string }
const account = process.env.DEMO_ACCOUNT ?? "you@example.com";
const events = async () => JSON.parse(await readFile(new URL("../fixtures/calendar.json", import.meta.url), "utf8")) as SampleEvent[];
const asEvent = (event: SampleEvent) => ({ id: event.id, summary: event.title, start: event.start, end: event.end });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const read = { readOnlyHint: true } as const;
const server = new McpServer({ name: "calendar-offline", version: "1.0.0" }, { instructions: `Google Calendar for ${account}, offline sample data.` });

server.registerTool("list_calendars", { description: "List calendars.", inputSchema: {}, annotations: read },
  () => text({ calendars: [{ id: "primary", summary: account }] }));

server.registerTool("list_events", {
  description: "List events in a time range (today by default).",
  inputSchema: { calendarId: z.string().optional(), timeMin: z.string().optional(), timeMax: z.string().optional() },
  annotations: read,
}, async () => text({ events: (await events()).map(asEvent) }));

server.registerTool("search_events", { description: "Find events by text.", inputSchema: { query: z.string() }, annotations: read },
  async ({ query }) => text({ events: (await events()).filter((event) => event.title.toLowerCase().includes(query.toLowerCase())).map(asEvent) }));

server.registerTool("get_event", { description: "Read one event.", inputSchema: { eventId: z.string() }, annotations: read },
  async ({ eventId }) => text((await events()).map(asEvent).find((event) => event.id === eventId) ?? { error: `No event ${eventId}` }));

server.registerTool("suggest_time", {
  description: "Suggest free times for a meeting.",
  inputSchema: { durationMinutes: z.number().int().positive(), attendees: z.array(z.string()).optional() },
  annotations: read,
}, () => text({ suggestions: ["tomorrow 10:00", "tomorrow 14:30"] }));

server.registerTool("update_event", {
  description: "Move or change an event.",
  inputSchema: { eventId: z.string(), start: z.string().optional(), end: z.string().optional(), summary: z.string().optional() },
}, (change) => text({ updated: change }));

server.registerTool("create_event", {
  description: "Create an event.",
  inputSchema: { summary: z.string(), start: z.string(), end: z.string(), attendees: z.array(z.string()).optional() },
}, (event) => text({ created: { id: `e-${Date.now().toString(36)}`, ...event } }));

await server.connect(new StdioServerTransport());
