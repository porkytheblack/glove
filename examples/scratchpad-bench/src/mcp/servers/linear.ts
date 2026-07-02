import { z } from "zod";
import { single } from "../spec";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function linearServer(world: World): ServerSpec {
  const issueCols = [
    { name: "id", type: "text", description: "e.g. ENG-123" },
    { name: "title", type: "text" },
    { name: "assignee", type: "text" },
    { name: "state", type: "text", description: "backlog | todo | in_progress | in_review | done | canceled" },
    { name: "priority", type: "bigint", description: "0 none … 4 urgent" },
    { name: "estimate", type: "bigint" },
    { name: "team", type: "text" },
    { name: "project", type: "text" },
    { name: "created_at", type: "timestamptz" },
    { name: "updated_at", type: "timestamptz" },
  ];

  return {
    namespace: "linear",
    title: "Linear",
    tools: [
      {
        name: "list_issues",
        description: "List Linear issues, optionally filtered by assignee, state, team, or project.",
        readOnly: true,
        input: {
          assignee: z.string().optional(),
          state: z.string().optional(),
          team: z.string().optional(),
          project: z.string().optional(),
        },
        handler: (a) =>
          world.linearIssues.filter(
            (i) =>
              (!a.assignee || lc(i.assignee) === lc(a.assignee)) &&
              (!a.state || lc(i.state) === lc(a.state)) &&
              (!a.team || lc(i.team) === lc(a.team)) &&
              (!a.project || lc(i.project) === lc(a.project)),
          ),
      },
      {
        name: "get_issue",
        description: "Get one Linear issue by its id (e.g. ENG-123).",
        readOnly: true,
        input: { id: z.string() },
        handler: (a) => world.linearIssues.find((i) => lc(i.id) === lc(a.id)) ?? null,
      },
      {
        name: "create_issue",
        description: "Create a Linear issue.",
        readOnly: false,
        input: {
          title: z.string(),
          team: z.string().optional(),
          assignee: z.string().optional(),
          priority: z.number().optional(),
          project: z.string().optional(),
        },
        handler: (a) => {
          const id = `ENG-${100 + world.linearIssues.length + world.outbox.filter((o) => o.kind === "linear.create_issue").length}`;
          world.outbox.push({ kind: "linear.create_issue", at: new Date(0).toISOString(), payload: a });
          return { id, title: a.title, team: a.team ?? "web", assignee: a.assignee ?? null, state: "todo", priority: a.priority ?? 0 };
        },
      },
      {
        name: "update_issue",
        description: "Update a Linear issue's state, assignee, or priority.",
        readOnly: false,
        input: { id: z.string(), state: z.string().optional(), assignee: z.string().optional(), priority: z.number().optional() },
        handler: (a) => {
          world.outbox.push({ kind: "linear.update_issue", at: new Date(0).toISOString(), payload: a });
          return { id: a.id, updated: true };
        },
      },
    ],
    entities: [
      {
        table: "linear_issues",
        description: "Linear issues. INSERT creates one; UPDATE (WHERE id=…) changes state/assignee/priority.",
        volatility: "stable",
        columns: issueCols,
        select: {
          tool: "list_issues",
          args: (b) => ({
            ...(single(b, "assignee") && { assignee: b.one("assignee") }),
            ...(single(b, "state") && { state: b.one("state") }),
            ...(single(b, "team") && { team: b.one("team") }),
            ...(single(b, "project") && { project: b.one("project") }),
          }),
        },
        insert: {
          tool: "create_issue",
          args: (r) => ({ title: r.title, team: r.team, assignee: r.assignee, priority: r.priority, project: r.project }),
        },
        update: {
          tool: "update_issue",
          args: (set, b) => ({ id: b.one("id"), ...set }),
        },
      },
    ],
  };
}
