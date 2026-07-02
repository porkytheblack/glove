import { z } from "zod";
import { single } from "../spec";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function calendarServer(world: World): ServerSpec {
  const cols = [
    { name: "id", type: "text" },
    { name: "title", type: "text" },
    { name: "start", type: "timestamptz" },
    { name: "end_at", type: "timestamptz" },
    { name: "organizer", type: "text" },
    { name: "attendees", type: "text", description: "comma-separated logins" },
    { name: "location", type: "text" },
  ];
  const shape = (e: (typeof world.calendarEvents)[number]) => ({
    id: e.id, title: e.title, start: e.start, end_at: e.end, organizer: e.organizer,
    attendees: e.attendees, location: e.location,
  });
  return {
    namespace: "calendar",
    title: "Google Calendar",
    tools: [
      {
        name: "list_events",
        description: "List calendar events, optionally filtered by organizer.",
        readOnly: true,
        input: { organizer: z.string().optional() },
        handler: (a) =>
          world.calendarEvents.filter((e) => !a.organizer || lc(e.organizer) === lc(a.organizer)).map(shape),
      },
      {
        name: "create_event",
        description: "Create a calendar event.",
        readOnly: false,
        input: { title: z.string(), start: z.string(), attendees: z.string().optional() },
        handler: (a) => {
          const id = `cal-out-${world.outbox.filter((o) => o.kind === "calendar.create_event").length + 1}`;
          world.outbox.push({ kind: "calendar.create_event", at: new Date(0).toISOString(), payload: a });
          return { id, title: a.title, start: a.start };
        },
      },
    ],
    entities: [
      {
        table: "calendar_events",
        description: "Calendar events. INSERT (title, start, attendees) schedules an event.",
        volatility: "stable",
        columns: cols,
        select: { tool: "list_events", args: (b) => ({ ...(single(b, "organizer") && { organizer: b.one("organizer") }) }) },
        insert: { tool: "create_event", args: (r) => ({ title: r.title, start: r.start, attendees: r.attendees ?? "" }) },
      },
    ],
  };
}
