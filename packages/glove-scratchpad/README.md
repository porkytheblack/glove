# glove-scratchpad

**A database emulator for LLM tool use.** Instead of loading dozens of tool
definitions into the context window, expose an agent's capabilities as a
relational database it queries with a **single `execute_sql` tool**. The model
already knows SQL — fluently, at every model size — so it discovers, invokes, and
composes capabilities by writing queries.

The idea (from *"SQL Is the Future"*): **resources become tables.** A resource is
an entity/data type — `github_pr`, `linear_issue`, `emails`, `time`, `images` —
and its CRUD verbs map to (possibly different) underlying tools:

```sql
-- discover what you can do
SELECT table_name FROM information_schema.tables;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks';

-- invoke a tool by querying its table; push arguments through WHERE
SELECT id, name FROM tasks WHERE due_date = (SELECT tomorrow FROM time);

-- compose across services in one statement — no intermediate rows in context
INSERT INTO notion_page (title, body)
SELECT title, body FROM github_pr WHERE merged = true AND base = 'main';

-- stage an outbound effect, preview it, then commit (or roll back — a dry run)
BEGIN;
INSERT INTO emails (to_addr, subject, body) VALUES ('a@b.com', 'hi', 'yo');
-- inspect what is staged, then:
COMMIT;
```

It is, at heart, a **SQL interpreter**: every statement is parsed and inspected
*before* any tool runs. That buys discovery (`information_schema`), composition
(joins / `INSERT … SELECT`), preview (`EXPLAIN`, transactions), and a real
security surface (a syntax tree you can reject) — for free, because the database
already solved them decades ago.

```bash
pnpm add glove-scratchpad
# zero runtime dependencies — the query engine (glove-sql) is bundled.
#
# OPTIONAL: a full Postgres dialect (WASM) instead of the bundled subset:
pnpm add @electric-sql/pglite
# OPTIONAL: bridge MCP servers in as tables:
pnpm add glove-mcp
```

## Quick start

```ts
import { Database, resourceFromTool, defineResource, mountDatabase } from "glove-scratchpad";
import { z } from "zod";

const db = await Database.create({ policy: { writes: true } });

// A read-only tool → a one-row `time` table. Columns come from a Zod schema
// (z.date() → timestamptz), so the shape is one source of truth.
db.register(resourceFromTool(getTimeTool, {
  name: "time", volatility: "stable",
  schema: z.object({ now: z.date(), tomorrow: z.string() }),
}));

// A search tool → a `web` table whose required `query` column is a pushed-down argument.
db.register(resourceFromTool(searchTool, {
  name: "web", volatility: "volatile",
  schema: z.object({ title: z.string(), url: z.string() }),
}));

// Fold the single tool + prime the model to discover → invoke → act → stage.
mountDatabase(agent, { db });
```

Now the model works entirely in SQL through `execute_sql` (and `explain_sql`).

For a runnable, no-API-key tour of every property below, see
[`examples/scratchpad-agent`](../../examples/scratchpad-agent) (`pnpm scratchpad:db`).

## The moving parts

| Concept | Code |
| --- | --- |
| Resource (a table) | `ResourceTable` (`glove-scratchpad/db`) |
| Author a resource | `defineResource({ name, schema, keys?, volatility, select?, insert?, update?, delete? })` — a Zod `schema` is the columns AND the end-to-end row type (or pass `columns` directly) |
| One tool → one resource | `resourceFromTool(tool, { name, volatility, schema \| columns, op? })` |
| The interpreter | `Database` — `execute(sql)` / `explain(sql)` |
| The single agent tool | `mountDatabase(glove, { db })` → folds `execute_sql` + `explain_sql` |
| MCP servers → tables | `mcpResources` / `mountMcpDatabase` (`glove-scratchpad/mcp`) |
| Query engine | [`glove-sql`](../glove-sql) (default) or PGlite (`glove-scratchpad/pglite`) |

## How a query runs

The query engine ([`glove-sql`](../glove-sql)) is synchronous; resources are
async and effectful. So `Database.execute` cannot hook resolution inside the
engine — it **pre-resolves**:

1. **Parse** the SQL (the same parser the engine executes — one grammar).
2. **Gate** it: a statement-kind whitelist, read-only by default, `CREATE`/`DROP`
   refused, multi-statement only as a `BEGIN … COMMIT/ROLLBACK` script. The
   model's capability is bounded by a syntax tree you inspect.
3. **Collect** every relation the statement references (FROM, JOINs, subqueries,
   CTE bodies, `INSERT … SELECT` source) and classify each as a resource or not.
4. **Push down** the `WHERE` / `JOIN-ON` equalities scoped to each resource —
   these are *arguments*, not just filters (Steampipe's required-key model);
   missing required keys are a clear error.
5. **Resolve** each resource **exactly once** (per the volatility model),
   **materialize** its rows into the engine, **run** the now-synchronous query,
   then **tear down** the ephemeral tables.

Resolving once, up front, is also what makes the [volatility](#volatility)
guarantee hold: the engine evaluates FROM-resolution lazily and repeatedly (once
per correlated-subquery row), so an inline async hook would invoke an effectful
tool N times. Pre-resolution invokes it once.

## Resources as tables

A resource is an entity with columns and any subset of CRUD verbs, each wired
independently. Define it with a **Zod schema** and one object is your columns AND
your end-to-end row type — the schema flows into every resolver, so `select`
returns rows of it, `insert` takes them, `update`'s `set` is a partial, and
`bindings.one("col")` autocompletes the schema's column names:

```ts
import { z } from "zod";

const githubPr = defineResource({
  name: "github_pr",
  volatility: "stable",
  schema: z.object({
    number: z.number().int().describe("PR number"),   // an API argument (see keys)
    title: z.string(),
    merged: z.boolean(),
  }),
  keys: ["number"],                                    // required WHERE-pushdown key(s), typed to the schema
  select: (b) => listPrs({ number: b.one("number") }), // SELECT  → a list/get tool
  insert: (rows) => createPr(rows[0]),                 // INSERT  → a create tool  (rows typed to the schema)
  update: (set, b) => updatePr(b.one("number"), set),  // UPDATE  → an update tool (set: Partial<row>)
  delete: (b) => closePr(b.one("number")),             // DELETE  → a close tool
});
```

Zod field types map to Postgres types (`z.number().int()` → `bigint`,
`z.number()` → `double precision`, `z.boolean()` → `boolean`, `z.date()` /
`z.iso.datetime()` → `timestamptz`, nested objects/arrays → `jsonb`);
`.describe(...)` becomes the column description (where authors put the enum /
allowed-value hints the model reads); `.meta({ pgType: "…" })` forces an exact
type. Prefer the schema, but a raw `columns: [{ name, type, requiredKey? }]` list
still works when you'd rather write the pg types by hand (`columnsFromZod` is
exported if you want the mapping standalone).

A read-only `time` has only `select`; an `emails` (send) is `insert`-only; an
`images` generator is a `select`-shaped but **volatile** function-as-relation
(`SELECT url FROM images WHERE prompt = '…'` — `prompt` is an argument). Verb
presence is the capability gate: SELECTing a write-only resource, or writing one
with no writer, is a clear error.

A resolver returns rows shaped by the schema; the interpreter maps them onto the
declared columns (nested values land in `jsonb`, reachable via `-> / ->>`).
Required-key columns are auto-stamped from the pushed-down WHERE, so a `select`
may omit them. DDL comes from the **declared** columns so the schema is stable
for `information_schema` even when a call returns zero rows.

## Volatility

Every resource declares `immutable | stable | volatile` (Postgres's model). It
governs caching and protects effectful tools from being called the wrong number
of times:

- **immutable** — cached for the database's lifetime (pure lookups).
- **stable** — cached within one `execute` (a turn-stable read, e.g. `time`).
- **volatile** — re-resolved each statement; never cached. A volatile read or
  write is invoked **exactly once** per statement no matter how the engine
  re-evaluates subqueries.

## Transactions = preview & staging

A write against a resource is a side-effecting tool call. Inside a transaction it
is **staged**, not fired — recorded with the exact resolver + arguments it will
invoke. `db.preview()` (and the `staged` field on the result) is the approval
surface; `COMMIT` fires the staged writes in order; `ROLLBACK` discards them — a
true dry run. This maps cleanly onto approval-gated outbound, with no new
machinery. Writes are off unless the `Database` is created with
`policy: { writes: true }`.

## EXPLAIN

`db.explain(sql)` (and the `explain_sql` tool, and `EXPLAIN <stmt>` through
`execute_sql`) runs the pre-pass only — **no resolver calls** — and reports which
resources a statement will hit, each one's volatility, read/write access, and the
arguments it resolved. Explaining a `generate_image` query costs nothing.

## Discovery is `information_schema`

There is no separate discovery step. Resources are advertised in
`information_schema.tables` / `.columns` (engine-agnostically, via a catalog
callback), so the agent lands in an unfamiliar database, lists its tables,
inspects the relevant ones, and figures out its own capabilities — exactly how
SQL has always done progressive disclosure.

## MCP servers → tables (`glove-scratchpad/mcp`)

Most MCP tools are CRUD over some resource type, so decompose a server into
resources and give each a table. `glove-mcp` is an optional peer dependency.

```ts
import { connectMcp } from "glove-mcp";
import { mountMcpDatabase } from "glove-scratchpad/mcp";

const conn = await connectMcp({ namespace: "github", url });
await mountMcpDatabase(db, conn, {
  table: (t) => t.name === "list_pull_requests"
    ? { name: "github_pr", op: "select", volatility: "stable",
        columns: [{ name: "title", type: "text" }, { name: "merged", type: "boolean" }],
        rows: (d) => JSON.parse(d as string) }
    : null,                       // skip the rest, or map them too
});
// → INSERT INTO linear_issue SELECT … FROM github_pr WHERE merged = true
//   composes two servers in one statement.
```

A read tool (`readOnlyHint`) defaults to a `select` resource; others default to a
volatile `insert`. MCP results rarely carry clean column lists, so declare
`columns` (and a `rows` extractor) via `table(tool)` to make a server's data
genuinely queryable.

## Backends

The manipulation surface is a defined Postgres subset; the backend behind it is
swappable (`ScratchpadBackend`).

- **`glove-sql`** (default) — a zero-dependency, pure-JS Postgres-subset engine.
  Covers the SQL agents write: joins, `GROUP BY`/`HAVING`, CTEs, set ops,
  correlated subqueries, window functions, `jsonb` access, a library of scalar
  functions, plus `information_schema`, `INSERT … SELECT`, and `UPDATE`. Anything
  outside the subset throws a clear error rather than mis-answering.
- **`PgliteBackend`** (`glove-scratchpad/pglite`) — embedded Postgres (WASM) for a
  full dialect. `@electric-sql/pglite` is an optional peer.
- **Bring your own** — implement `ScratchpadBackend` over real Postgres, SQLite, a
  remote service.

```ts
import { Database } from "glove-scratchpad";
import { PgliteBackend } from "glove-scratchpad/pglite";

const db = await Database.create({ backend: await PgliteBackend.create() });
```

## API

```ts
const db = await Database.create({ policy?: { writes }, backend?, actor? });
db.register(resource);                  // or registerAll([...])
await db.execute(sql, { params?, limit?, allowWrites?, signal? });   // → { rows, truncated, touched, staged?, committed?, message? }
await db.explain(sql, { params? });     // → { statementKind, readOnly, relations, staged? }  (runs no resolvers)
db.preview();                           // staged writes in the open transaction
mountDatabase(glove, { db, prime?, explain?, allowWrites? });        // fold execute_sql (+ explain_sql) and prime the prompt
```

## What this is not

The honest limits (named in the essay):

- **Effectful relations are volatile.** A `SELECT` that costs money / is
  nondeterministic is a volatile relation; the interpreter carries a volatility
  model so the engine can't quietly call it the wrong number of times — but you
  own declaring volatility correctly.
- **Atomic conditional composition doesn't reduce.** Branching where the next
  tool depends on a prior tool's output, *inside one statement*, is
  imperative-vs-declarative — punt it to the agent loop (query, look, query
  again).
- **Tables are live views, not stored data.** Rate limits, pagination, and
  partial failure when one service times out mid-`JOIN` are real and yours to
  handle in the resolver.

## Status

Draft. The default backend covers the SQL subset the emulator and its agents use;
swap in `PgliteBackend` when a workflow outgrows it. The empirical "how small a
SQL surface covers what fraction of real tool use" question is left open by
design.

## License

MIT
