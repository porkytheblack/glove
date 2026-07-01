import { z } from "zod";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function githubServer(world: World): ServerSpec {
  const prCols = [
    { name: "number", type: "bigint", requiredKey: false },
    { name: "repo", type: "text" },
    { name: "title", type: "text" },
    { name: "author", type: "text" },
    { name: "state", type: "text", description: "open | merged | closed" },
    { name: "additions", type: "bigint" },
    { name: "deletions", type: "bigint" },
    { name: "created_at", type: "timestamptz" },
    { name: "merged_at", type: "timestamptz" },
    { name: "base", type: "text" },
    { name: "closes_linear", type: "text", description: "Linear issue id this PR closes, if any" },
    { name: "body", type: "text" },
  ];
  const issueCols = [
    { name: "number", type: "bigint" },
    { name: "repo", type: "text" },
    { name: "title", type: "text" },
    { name: "author", type: "text" },
    { name: "state", type: "text", description: "open | closed" },
    { name: "labels", type: "text", description: "comma-separated" },
    { name: "comments", type: "bigint" },
    { name: "created_at", type: "timestamptz" },
    { name: "body", type: "text" },
  ];

  return {
    namespace: "github",
    title: "GitHub",
    tools: [
      {
        name: "list_pull_requests",
        description: "List pull requests, optionally filtered by repo, state (open/merged/closed), or author.",
        readOnly: true,
        input: { repo: z.string().optional(), state: z.string().optional(), author: z.string().optional() },
        handler: (a) =>
          world.githubPrs.filter(
            (p) =>
              (!a.repo || lc(p.repo) === lc(a.repo)) &&
              (!a.state || lc(p.state) === lc(a.state)) &&
              (!a.author || lc(p.author) === lc(a.author)),
          ),
      },
      {
        name: "get_pull_request",
        description: "Get a single pull request by repo and number.",
        readOnly: true,
        input: { repo: z.string(), number: z.number() },
        handler: (a) => world.githubPrs.find((p) => p.number === Number(a.number)) ?? null,
      },
      {
        name: "list_issues",
        description: "List GitHub issues, optionally filtered by repo, state, or a label substring.",
        readOnly: true,
        input: { repo: z.string().optional(), state: z.string().optional(), labels: z.string().optional() },
        handler: (a) =>
          world.githubIssues.filter(
            (i) =>
              (!a.repo || lc(i.repo) === lc(a.repo)) &&
              (!a.state || lc(i.state) === lc(a.state)) &&
              (!a.labels || lc(i.labels).includes(lc(a.labels))),
          ),
      },
      {
        name: "create_issue",
        description: "Open a new GitHub issue.",
        readOnly: false,
        input: { repo: z.string(), title: z.string(), body: z.string().optional() },
        handler: (a) => {
          const number = 2000 + world.githubIssues.length + world.outbox.filter((o) => o.kind === "github.create_issue").length;
          world.outbox.push({ kind: "github.create_issue", at: new Date(0).toISOString(), payload: a });
          return { number, repo: a.repo, title: a.title, url: `https://github.com/${a.repo}/issues/${number}`, state: "open" };
        },
      },
      {
        name: "search_code",
        description: "Search file paths across repos for a substring.",
        readOnly: true,
        input: { query: z.string() },
        handler: (a) => world.files.filter((f) => lc(f.path).includes(lc(a.query))).slice(0, 25),
      },
    ],
    entities: [
      {
        table: "github_pull_requests",
        description: "Pull requests across all acme repos.",
        volatility: "stable",
        columns: prCols,
        select: {
          tool: "list_pull_requests",
          args: (b) => ({
            ...(b.has("repo") && { repo: b.one("repo") }),
            ...(b.has("state") && { state: b.one("state") }),
            ...(b.has("author") && { author: b.one("author") }),
          }),
        },
      },
      {
        table: "github_issues",
        description: "GitHub issues. INSERT opens a new issue.",
        volatility: "stable",
        columns: issueCols,
        select: {
          tool: "list_issues",
          args: (b) => ({
            ...(b.has("repo") && { repo: b.one("repo") }),
            ...(b.has("state") && { state: b.one("state") }),
            ...(b.has("labels") && { labels: b.one("labels") }),
          }),
        },
        insert: { tool: "create_issue", args: (r) => ({ repo: r.repo, title: r.title, body: r.body ?? "" }) },
      },
    ],
  };
}
