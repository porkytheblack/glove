import { z } from "zod";
import { single } from "../spec";
import type { ServerSpec } from "../spec";
import type { World } from "../seed";

const lc = (v: unknown) => String(v ?? "").toLowerCase();

export function notionServer(world: World): ServerSpec {
  const cols = [
    { name: "id", type: "text" },
    { name: "title", type: "text" },
    { name: "database", type: "text" },
    { name: "author", type: "text" },
    { name: "last_edited", type: "timestamptz" },
    { name: "url", type: "text" },
  ];
  return {
    namespace: "notion",
    title: "Notion",
    tools: [
      {
        name: "search_pages",
        description: "Search Notion pages by title substring, optionally within a database.",
        readOnly: true,
        input: { query: z.string().optional(), database: z.string().optional() },
        handler: (a) =>
          world.notionPages.filter(
            (p) =>
              (!a.query || lc(p.title).includes(lc(a.query))) &&
              (!a.database || lc(p.database) === lc(a.database)),
          ),
      },
      {
        name: "list_databases",
        description: "List Notion databases.",
        readOnly: true,
        input: {},
        handler: () => [...new Set(world.notionPages.map((p) => p.database))].map((d) => ({ database: d })),
      },
      {
        name: "create_page",
        description: "Create a Notion page in a database.",
        readOnly: false,
        input: { title: z.string(), database: z.string(), body: z.string().optional() },
        handler: (a) => {
          const id = `nt-out-${world.outbox.filter((o) => o.kind === "notion.create_page").length + 1}`;
          world.outbox.push({ kind: "notion.create_page", at: new Date(0).toISOString(), payload: a });
          return { id, title: a.title, database: a.database, url: `https://notion.so/acme/${id}` };
        },
      },
    ],
    entities: [
      {
        table: "notion_pages",
        description: "Notion pages (docs, postmortems, RFCs). INSERT creates a page.",
        volatility: "stable",
        columns: [...cols, { name: "body", type: "text" }],
        select: {
          tool: "search_pages",
          args: (b) => ({
            ...(single(b, "title") && { query: b.one("title") }),
            ...(single(b, "database") && { database: b.one("database") }),
          }),
        },
        insert: { tool: "create_page", args: (r) => ({ title: r.title, database: r.database ?? "Docs", body: r.body ?? "" }) },
      },
    ],
  };
}
