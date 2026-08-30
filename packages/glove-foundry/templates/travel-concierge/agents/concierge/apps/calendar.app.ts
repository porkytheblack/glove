import { Effect } from "effect";
import { defineApp } from "glove-foundry";
import { z } from "zod";
import messaging from "../transmissions/messaging.transmission.js";

/**
 * An application is a capability an *instance* installs, not something the
 * definition always has. Two concierge instances can run the same code with
 * different calendars, or with none at all.
 *
 * `config` is validated when the instance installs it, so `install` receives a
 * typed value. Swap the in-memory `HELD` map for a real calendar API.
 */
const HELD = new Map<string, { readonly start: string; readonly end: string }>();

const calendar = defineApp({
  description: "Read a traveller's calendar and hold provisional trip dates",
  config: z.object({
    calendarId: z.string().default("primary"),
    timezone: z.string().default("UTC"),
  }),
  // Declaring the transmission here lets an installed instance send messages.
  inbound: [messaging],
  outbound: [messaging],
  install: ({ config }) => Effect.succeed({
    tools: [
      {
        name: "calendar_check_availability",
        description: "Check whether a date range is free on the traveller's calendar",
        inputSchema: z.object({
          start: z.string().describe("ISO start date, for example 2026-04-02"),
          end: z.string().describe("ISO end date, for example 2026-04-09"),
        }),
        async do({ start, end }) {
          const clash = [...HELD.values()].find((hold) => hold.start <= end && start <= hold.end);
          return {
            status: "success" as const,
            data: {
              calendarId: config.calendarId,
              timezone: config.timezone,
              available: !clash,
              ...(clash ? { conflictsWith: clash } : {}),
            },
          };
        },
      },
      {
        name: "calendar_hold_dates",
        description: "Place a provisional hold on a date range while the trip is being planned",
        inputSchema: z.object({
          label: z.string().describe("What the hold is for, for example 'Nairobi trip'"),
          start: z.string(),
          end: z.string(),
        }),
        async do({ label, start, end }) {
          HELD.set(label, { start, end });
          return {
            status: "success" as const,
            data: { held: true, label, start, end, calendarId: config.calendarId },
          };
        },
      },
    ],
  }),
});

export default calendar;
