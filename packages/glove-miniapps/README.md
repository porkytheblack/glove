# glove-miniapps

**Exploratory.** Private, `0.0.1`, not published. The design and its evaluation are in [`docs/miniapps-design.md`](../../docs/miniapps-design.md).

Durable mini apps that agents build for themselves. An app has a typed schema, methods that become tools, checked migrations, an event log and scheduled outputs. It belongs to an agent, outlives the conversation that made it, and can be shared with other agents one method at a time.

It runs fully in memory (glove-sql for rows, glove-js for method bodies), or on SQLite or Postgres through a backend adapter. It serves the same API over HTTP, so a platform such as Kuiper can host the apps for a Foundry instance.

```ts
import { createAppHost, memoryBackend, mountMiniApps } from "glove-miniapps";

const host = await createAppHost({ backend: memoryBackend() });
await mountMiniApps(agent, { host, as: "agent:planner" }); // tools + "your apps" before every turn
```

## An app

```ts
await host.deploy({
  name: "tasks",
  description: "Open tasks and when they were done",
  schema: {
    tasks: { columns: {
      id: { type: "integer", primaryKey: true },        // assigned on insert
      title: { type: "text", unique: true },
      done: { type: "boolean", default: false },
      created_at: { type: "timestamp" },
    } },
  },
  methods: {
    add: {
      kind: "action", description: "Add a task",
      params: { title: { type: "string" } },
      sql: "INSERT INTO tasks (title, created_at) VALUES (:title, :now) RETURNING id, title",
      returns: "one", emits: "added",
    },
    open: { kind: "query", description: "Open tasks", sql: "SELECT id, title FROM tasks WHERE done = false ORDER BY id" },
    complete: {
      kind: "action", description: "Mark a task done",
      params: { id: { type: "integer" } },
      js: `const row = db.one({ sql: 'UPDATE tasks SET done = true WHERE id = :id RETURNING id, title', params: { id: args.id } });
           if (!row) throw new Error('no task ' + args.id);
           app.emit({ event: 'completed', data: row });
           row`,
    },
  },
  outputs: {
    weekly: { description: "How many are done", every: "7d", sql: "SELECT count(*) AS finished FROM tasks WHERE done = true" },
  },
}, { as: "agent:planner" });

await host.call("tasks", "add", { title: "Ship it" }, { as: "agent:planner" });
```

- **Queries read; actions change.** An action runs in one transaction. If it throws, breaks a constraint or runs out of fuel, it changes nothing.
- **SQL methods** use `:name` parameters, plus `:caller` and `:now`. They are parsed at deploy time, which catches a query that writes, an unknown table, an undeclared parameter, or a function that doesn't run the same on every backend.
- **JS methods** run in glove-js, a sandboxed interpreter with a fuel budget. `args` and `ctx` are in scope; `db.query`, `db.one`, `app.emit` and `apps.query` are the only capabilities.
- **Upgrading** means deploying the whole new definition. Additive changes migrate themselves. Renames and drops need `migration: { ops }`, and the host checks that the ops produce the declared schema before it touches any data. `dryRun` runs the migration and rolls it back.
- **Sharing:** `host.grant(app, { to, methods, events? })`. Another app can subscribe to an app's events (`subscriptions: [{ on: "tasks.completed", run: "award" }]`) once its owner holds the `events` grant.

## Backends

| | Import | Notes |
| --- | --- | --- |
| Memory | `memoryBackend()` | glove-sql on the heap. `snapshot()` serialises everything. Atomicity is a dump and a restore, so an action costs O(app size): about 1.5 ms at 1,000 rows and 10 ms at 5,000 (`bench/actions.ts`). |
| SQLite | `sqliteBackend({ dir })` from `glove-miniapps/sqlite` | One file per app (or `:memory:`), STRICT tables. `node:sqlite` by default; `open` takes better-sqlite3. About 0.1 ms per action. |
| Postgres | `postgresBackend({ pool })` from `glove-miniapps/postgres` | One schema per app. Bring a `pg.Pool`. |
| Remote | `remoteAppHost({ url, apiKey })` | Not a backend: a whole `AppHost` over HTTP (`serveMiniApps` is the other end). |

## Surfaces

| | |
| --- | --- |
| `mountMiniApps(agent, { host, as, exposeMethods? })` | Seven `glove_miniapps_*` tools, and the agent's app list before every turn. `exposeMethods` adds one tool per method and keeps them in sync. |
| `miniAppFns({ host, as })` | The same operations as `ToolFn`s: `defineTools({ name: "apps", fns })` gives working-environment scripts `import { invoke } from "env:apps"`. They also mount unchanged in a glove-js REPL. |
| `miniAppsLayer({ host })` from `glove-miniapps/foundry` | Options for Foundry's `defineLayer`. Apps belong to `agent:<agentId>`, so they follow the agent instance across conversations. |
| `serveMiniApps(host, { authenticate })` | A fetch-style handler for hosting. Keys decide the principal; a trusted key may act for its agents. |
| `startTicker(host)` | Runs due outputs every minute. |

## Tests

```sh
pnpm --filter glove-miniapps test
# with Postgres too:
MINIAPPS_TEST_DATABASE_URL=postgres://… pnpm --filter glove-miniapps test
```

The behavioural suite runs on every backend. That includes the deploy tool's worked example (`EXAMPLE_APP`), so the example a model copies from is known to work.
