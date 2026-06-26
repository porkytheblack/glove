# glove-sql

A **zero-dependency, pure-JS Postgres-subset SQL engine.** Tables are built at
runtime from whatever data you ingest (no fixed schema), and a small engine —
tokenizer → recursive-descent parser → evaluator — runs a defined subset of
Postgres over them. The whole store serialises to bytes and back ("computation as
a value"), with none of a real database's data-dir overhead.

It is the default backend for [`glove-scratchpad`](../glove-scratchpad), extracted
into its own package so the SQL surface can be tested and grown independently.

```ts
import { MemoryBackend } from "glove-sql";

const db = await MemoryBackend.create();
await db.exec(`CREATE TABLE "t" ("id" bigint, "name" text, "score" double precision)`);
await db.query(`INSERT INTO "t" VALUES ($1,$2,$3),($4,$5,$6)`, [1, "Ada", 9.5, 2, "Linus", 8.0]);

const { rows } = await db.query(
  `SELECT name, ROW_NUMBER() OVER (ORDER BY score DESC) AS rank FROM "t"`,
);
// → [{ name: "Ada", rank: 1 }, { name: "Linus", rank: 2 }]

const bytes = await db.dump();                     // serialise…
const restored = await MemoryBackend.create({ load: bytes }); // …and restore
```

## What it covers

| Area | Supported |
| --- | --- |
| **DDL** | `CREATE TABLE [IF NOT EXISTS]`, `CREATE TABLE … AS <select>`, `DROP TABLE [IF EXISTS] … [CASCADE]` |
| **DML** | `INSERT … VALUES (…), (…)`, `DELETE … [WHERE …]` (with `$n` params) |
| **Joins** | `INNER` / `LEFT` / `RIGHT` / `FULL` / `CROSS` |
| **Clauses** | `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET` (ORDER/GROUP by alias or ordinal), `WITH` (CTEs) |
| **Set ops** | `UNION` / `UNION ALL` / `INTERSECT` / `EXCEPT` |
| **Subqueries** | scalar `(SELECT …)`, `IN (SELECT …)`, `EXISTS` / `NOT EXISTS` — including correlated |
| **Expressions** | `CASE`, `BETWEEN`, `IN`, `IS [NOT] NULL`, `CAST(x AS t)` / `::t`, jsonb `->` / `->>` |
| **Aggregates** | `count` / `sum` / `avg` / `min` / `max`, with `FILTER (WHERE …)` |
| **Windows** | `row_number`, `rank`, `dense_rank`, aggregate `OVER (PARTITION BY … ORDER BY …)`, `lag` / `lead`, `first_value` |
| **Functions** | `coalesce`, `nullif`, `round`, `floor`, `ceil`, `abs`, `sqrt`, `power`, `mod`, `greatest`, `least`, `lower`, `upper`, `length`, `trim`, `substr`, `replace`, `concat`, `strpos`, … |

Anything outside the subset throws a clear error rather than silently
mis-answering. For the long tail (recursive CTEs, `GROUPING SETS`, `DISTINCT ON`,
explicit window frames, …) bring a real Postgres backend.

## API

```ts
interface SqlBackend {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  exec(sql: string): Promise<void>;
  dump(): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface SqlResult { rows: Record<string, unknown>[]; fields: { name: string }[] }

class MemoryBackend implements SqlBackend {
  static create(opts?: { load?: Uint8Array }): Promise<MemoryBackend>;
}
```

## License

MIT
