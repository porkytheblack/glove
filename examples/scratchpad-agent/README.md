# scratchpad-agent — the database emulator, no API key

A deterministic, zero-dependency walkthrough of [`glove-scratchpad`](../../packages/glove-scratchpad) — the **database emulator** that exposes an agent's capabilities as a relational database it queries with one `execute_sql` tool.

```bash
pnpm scratchpad:db
```

It drives `Database.execute` directly (instead of a model) so the output is reproducible, and demonstrates the load-bearing properties end to end:

- **Discovery** — capabilities are found via `information_schema.tables` / `.columns`, not a list baked into a prompt.
- **WHERE-pushdown** — `SELECT … FROM web WHERE query = '…'` feeds `query` to the underlying tool as an argument; other predicates filter the rows in SQL.
- **Composition** — `INSERT INTO notion_page SELECT … FROM web …` pipes one capability into another in a single statement; no intermediate rows return to the model.
- **Transactions / staging** — `BEGIN … COMMIT` fires writes in order; `BEGIN … ROLLBACK` is a dry run.
- **EXPLAIN** — which tools a query will hit (and their volatility), without running anything.
- **Volatility** — an effectful resource is invoked exactly once per statement (the printed call counts prove it).

In a real agent you'd `mountDatabase(glove, { db })` and the model would write the very same SQL through `execute_sql`. See `database.ts` for the full, commented script.
