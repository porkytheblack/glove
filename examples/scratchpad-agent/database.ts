/**
 * glove-scratchpad — the database emulator, end to end, with NO API key and NO
 * database. Run with:  pnpm scratchpad:db
 *
 * It drives `Database.execute` directly (instead of a model) so the transcript is
 * deterministic, and proves the load-bearing properties:
 *   - DISCOVERY via information_schema (no capability list in a prompt)
 *   - WHERE-pushdown (arguments fed to a tool, not just filters)
 *   - COMPOSITION across resources in one statement (INSERT … SELECT)
 *   - TRANSACTION staging: BEGIN … ROLLBACK is a dry run; COMMIT fires
 *   - EXPLAIN: which tools a query hits, before running it
 *   - VOLATILITY: an effectful resource is invoked EXACTLY once
 *
 * In a real agent you'd `mountDatabase(glove, { db })` and the model would write
 * the very same SQL through the single `execute_sql` tool.
 */
import { Database, defineResource, resourceFromTool } from "glove-scratchpad";
import type { GloveFoldArgs } from "glove-core/glove";
import { z } from "zod";

// A call counter so we can SEE volatility enforcement.
const calls = { search: 0, send: 0 };

// ── a read-only tool → a resource ────────────────────────────────────────────
const getTime: GloveFoldArgs<Record<string, never>> = {
  name: "get_time",
  description: "The current time.",
  inputSchema: z.object({}),
  async do() {
    return { status: "success", data: { now: "2026-06-29T12:00:00Z", tomorrow: "2026-06-30" } };
  },
};

// ── a search tool → a volatile resource with a required-key column ────────────
const webSearch: GloveFoldArgs<{ query: string }> = {
  name: "web_search",
  description: "Search the web.",
  inputSchema: z.object({ query: z.string() }),
  async do(input) {
    calls.search++;
    return {
      status: "success",
      data: [
        { title: `${input.query} — a primer`, url: "https://ex/1", score: 9 },
        { title: `${input.query} in practice`, url: "https://ex/2", score: 7 },
      ],
    };
  },
};

async function main() {
  const db = await Database.create({ policy: { writes: true } });

  // time: stable, read-only.
  db.register(
    resourceFromTool(getTime, {
      name: "time",
      volatility: "stable",
      columns: [{ name: "now", type: "timestamptz" }, { name: "tomorrow", type: "text" }],
    }),
  );

  // web: volatile; `query` is a required-key column (a tool argument, pushed via WHERE).
  // The OUTPUT columns are declared with a Zod schema (`z.number().int()` → bigint,
  // etc.) instead of hand-written pg-type strings — one source of truth.
  db.register(
    resourceFromTool(webSearch, {
      name: "web",
      volatility: "volatile",
      schema: z.object({
        title: z.string(),
        url: z.string(),
        score: z.number().int(),
      }),
    }),
  );

  // notion_page: insert-only (a "create" capability), staged + fired on COMMIT.
  // Zod-first: the schema IS the columns AND the row type — `rows` below is typed
  // `{ title: string; url: string }[]`, checked end to end (a typo is a build error).
  const created: { title: string; url: string }[] = [];
  db.register(
    defineResource({
      name: "notion_page",
      description: "Pages in a Notion database.",
      volatility: "volatile",
      schema: z.object({
        title: z.string().describe("Page title"),
        url: z.string().describe("Canonical URL"),
      }),
      insert: async (rows) => {
        calls.send++;
        created.push(...rows);
        return { created: rows.length };
      },
    }),
  );

  const show = (label: string, v: unknown) => console.log(`\n# ${label}\n${JSON.stringify(v, null, 2)}`);

  // 1. DISCOVERY — the agent learns its capabilities from the catalog.
  show(
    "discover: information_schema.tables",
    (await db.execute(`SELECT table_name, table_type FROM information_schema.tables ORDER BY table_name`)).rows,
  );
  show(
    "discover: columns of 'web'",
    (await db.execute(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'web' ORDER BY ordinal_position`,
    )).rows,
  );

  // 2. INVOKE — push the query down as an argument, filter the rows in SQL.
  show(
    "invoke: SELECT title, url FROM web WHERE query = 'sql engines' AND score >= 8",
    (await db.execute(`SELECT title, url FROM web WHERE query = 'sql engines' AND score >= 8`)).rows,
  );

  // 3. EXPLAIN — see which tools a query hits (and their volatility) before running.
  show(
    "explain: SELECT … FROM web WHERE query = 'rust'",
    await db.explain(`SELECT url FROM web WHERE query = 'rust'`),
  );

  // 4. COMPOSE + STAGE — pipe a search into notion_page inside a transaction.
  await db.execute(`BEGIN`);
  const staged = await db.execute(
    `INSERT INTO notion_page (title, url) SELECT title, url FROM web WHERE query = 'agents'`,
  );
  show("staged (nothing sent yet)", { staged: staged.staged, createdSoFar: created.length });
  show("commit", await db.execute(`COMMIT`));
  show("after commit, notion_page received", created);

  // 5. DRY RUN — BEGIN … ROLLBACK fires nothing.
  const before = created.length;
  await db.execute(`BEGIN; INSERT INTO notion_page (title, url) VALUES ('discarded', 'x'); ROLLBACK`);
  show("rollback is a dry run — created count unchanged", { before, after: created.length });

  // 6. VOLATILITY — every web reference above invoked the tool exactly once each.
  show("call counts (volatility enforced)", calls);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
