import { z } from "zod";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function jiraServer(world: World): ServerSpec {
  const cols = [
    { name: "key", type: "text", description: "e.g. OPS-201" },
    { name: "summary", type: "text" },
    { name: "assignee", type: "text" },
    { name: "status", type: "text", description: "To Do | In Progress | In Review | Done" },
    { name: "priority", type: "text", description: "Low | Medium | High | Critical" },
    { name: "sprint", type: "text" },
    { name: "story_points", type: "bigint" },
    { name: "created_at", type: "timestamptz" },
  ];
  return {
    namespace: "jira",
    title: "Jira",
    tools: [
      {
        name: "search_issues",
        description: "Search Jira issues by assignee, status, priority, or sprint.",
        readOnly: true,
        input: {
          assignee: z.string().optional(),
          status: z.string().optional(),
          priority: z.string().optional(),
          sprint: z.string().optional(),
        },
        handler: (a) =>
          world.jiraIssues.filter(
            (i) =>
              (!a.assignee || lc(i.assignee) === lc(a.assignee)) &&
              (!a.status || lc(i.status) === lc(a.status)) &&
              (!a.priority || lc(i.priority) === lc(a.priority)) &&
              (!a.sprint || lc(i.sprint) === lc(a.sprint)),
          ),
      },
      {
        name: "get_issue",
        description: "Get a Jira issue by key.",
        readOnly: true,
        input: { key: z.string() },
        handler: (a) => world.jiraIssues.find((i) => lc(i.key) === lc(a.key)) ?? null,
      },
      {
        name: "transition_issue",
        description: "Move a Jira issue to a new status.",
        readOnly: false,
        input: { key: z.string(), status: z.string() },
        handler: (a) => {
          world.outbox.push({ kind: "jira.transition", at: new Date(0).toISOString(), payload: a });
          return { key: a.key, status: a.status, ok: true };
        },
      },
    ],
    entities: [
      {
        table: "jira_issues",
        description: "Jira issues. UPDATE (WHERE key=…) transitions status.",
        volatility: "stable",
        columns: cols,
        select: {
          tool: "search_issues",
          args: (b) => ({
            ...(b.has("assignee") && { assignee: b.one("assignee") }),
            ...(b.has("status") && { status: b.one("status") }),
            ...(b.has("priority") && { priority: b.one("priority") }),
            ...(b.has("sprint") && { sprint: b.one("sprint") }),
          }),
        },
        update: { tool: "transition_issue", args: (set, b) => ({ key: b.one("key"), status: set.status }) },
      },
    ],
  };
}
