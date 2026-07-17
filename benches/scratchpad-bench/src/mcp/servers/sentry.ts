import { z } from "zod";
import { single } from "../spec";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function sentryServer(world: World): ServerSpec {
  const cols = [
    { name: "id", type: "text" },
    { name: "title", type: "text" },
    { name: "culprit", type: "text" },
    { name: "level", type: "text", description: "error | warning | fatal" },
    { name: "count", type: "bigint", description: "event count" },
    { name: "users_affected", type: "bigint" },
    { name: "status", type: "text", description: "unresolved | resolved | ignored" },
    { name: "project", type: "text", description: "service name: web-frontend | api-gateway | billing | mobile-bff | search" },
    { name: "first_seen", type: "timestamptz" },
    { name: "last_seen", type: "timestamptz" },
  ];
  return {
    namespace: "sentry",
    title: "Sentry",
    tools: [
      {
        name: "list_issues",
        description: "List Sentry issues, optionally filtered by project, status, or level.",
        readOnly: true,
        input: { project: z.string().optional(), status: z.string().optional(), level: z.string().optional() },
        handler: (a) =>
          world.sentryIssues.filter(
            (i) =>
              (!a.project || lc(i.project) === lc(a.project)) &&
              (!a.status || lc(i.status) === lc(a.status)) &&
              (!a.level || lc(i.level) === lc(a.level)),
          ),
      },
      {
        name: "resolve_issue",
        description: "Mark a Sentry issue resolved.",
        readOnly: false,
        input: { id: z.string() },
        handler: (a) => {
          world.outbox.push({ kind: "sentry.resolve", at: new Date(0).toISOString(), payload: a });
          return { id: a.id, status: "resolved" };
        },
      },
    ],
    entities: [
      {
        table: "sentry_issues",
        description: "Sentry error groups. UPDATE (WHERE id=…) SET status='resolved' resolves an issue.",
        volatility: "stable",
        columns: cols,
        select: {
          tool: "list_issues",
          args: (b) => ({
            ...(single(b, "project") && { project: b.one("project") }),
            ...(single(b, "status") && { status: b.one("status") }),
            ...(single(b, "level") && { level: b.one("level") }),
          }),
        },
        update: { tool: "resolve_issue", args: (_set, b) => ({ id: b.one("id") }) },
      },
    ],
  };
}
