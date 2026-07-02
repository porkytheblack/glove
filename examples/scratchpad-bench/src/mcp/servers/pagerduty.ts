import { z } from "zod";
import { single } from "../spec";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function pagerdutyServer(world: World): ServerSpec {
  const cols = [
    { name: "id", type: "text" },
    { name: "title", type: "text" },
    { name: "service", type: "text" },
    { name: "status", type: "text", description: "triggered | acknowledged | resolved" },
    { name: "urgency", type: "text", description: "high | low" },
    { name: "assignee", type: "text" },
    { name: "created_at", type: "timestamptz" },
  ];
  return {
    namespace: "pagerduty",
    title: "PagerDuty",
    tools: [
      {
        name: "list_incidents",
        description: "List incidents, optionally filtered by status, urgency, or service.",
        readOnly: true,
        input: { status: z.string().optional(), urgency: z.string().optional(), service: z.string().optional() },
        handler: (a) =>
          world.pagerIncidents.filter(
            (i) =>
              (!a.status || lc(i.status) === lc(a.status)) &&
              (!a.urgency || lc(i.urgency) === lc(a.urgency)) &&
              (!a.service || lc(i.service) === lc(a.service)),
          ),
      },
      {
        name: "get_incident",
        description: "Get one incident by id (e.g. PD-401).",
        readOnly: true,
        input: { id: z.string() },
        handler: (a) => world.pagerIncidents.find((i) => lc(i.id) === lc(a.id)) ?? null,
      },
      {
        name: "acknowledge_incident",
        description: "Acknowledge an incident.",
        readOnly: false,
        input: { id: z.string() },
        handler: (a) => {
          world.outbox.push({ kind: "pagerduty.ack", at: new Date(0).toISOString(), payload: a });
          return { id: a.id, status: "acknowledged" };
        },
      },
    ],
    entities: [
      {
        table: "pagerduty_incidents",
        description: "Incidents. UPDATE (WHERE id=…) SET status='acknowledged' acks an incident.",
        volatility: "stable",
        columns: cols,
        select: {
          tool: "list_incidents",
          args: (b) => ({
            ...(single(b, "status") && { status: b.one("status") }),
            ...(single(b, "urgency") && { urgency: b.one("urgency") }),
            ...(single(b, "service") && { service: b.one("service") }),
          }),
        },
        update: { tool: "acknowledge_incident", args: (_set, b) => ({ id: b.one("id") }), fanOut: "id" },
      },
    ],
  };
}
