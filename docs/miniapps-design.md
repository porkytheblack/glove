# Mini apps: design exploration

Status: exploratory. There is a working prototype in [`packages/glove-miniapps`](../packages/glove-miniapps) (private, `0.0.1`). It has 55 tests, and its behavioural suite runs on four backend configurations. This document describes what the API looks like, how it differs from working environments, and what was learned building it. Kuiper's side is in `kuiper-sh/kuiper`, `docs/specs/mini-apps.md`.

## The idea

Agents keep state in two places today. The conversation is per conversation. A working environment is a tree of files that can be snapshotted. Neither is a good home for the things an agent keeps coming back to, such as a task list, a ledger, a log of what a user has tried, or a report it sends every Monday. So the agent rebuilds that state in each conversation, or hides it in files that only it can parse.

A mini app is a small, durable, typed program the agent writes for itself:

- **data:** tables with a declared schema;
- **execution:** methods over those tables, which become the agent's tools;
- **schemas and migrations:** a new version declares its schema, and the host checks that the migration produces it;
- **repetitive outputs:** read-only computations that run on a cadence;
- **sharing:** grants per method, and subscriptions to another app's events.

It belongs to an agent instance, not a conversation. The agent is told which apps it has before every turn.

## What it looks like

### The definition

A definition is plain JSON: the agent writes it in a tool call, the host stores it as text, and Kuiper receives the same object over HTTP. This is the worked example the deploy tool shows the model (`src/example.ts`). The test suite deploys and runs it on every backend.

```json
{
  "name": "habits",
  "description": "Habits I'm tracking and the days I did them",
  "schema": {
    "checkins": {
      "columns": {
        "id":    { "type": "integer", "primaryKey": true },
        "habit": { "type": "text" },
        "day":   { "type": "text" },
        "note":  { "type": "text", "nullable": true }
      },
      "indexes": [["habit", "day"]]
    }
  },
  "methods": {
    "check_in": {
      "kind": "action", "description": "Record a habit done on a day",
      "params": { "habit": { "type": "string" }, "day": { "type": "string" }, "note": { "type": "string", "optional": true } },
      "sql": "INSERT INTO checkins (habit, day, note) VALUES (:habit, :day, :note) RETURNING id, habit, day",
      "returns": "one", "emits": "checked_in"
    },
    "streak": {
      "kind": "query", "description": "How many days in a row a habit was done, ending today",
      "params": { "habit": { "type": "string" } },
      "js": "const days = db.query({ sql: 'SELECT DISTINCT day FROM checkins WHERE habit = :habit ORDER BY day DESC', params: { habit: args.habit } }).map(r => r.day); … n"
    }
  },
  "outputs": {
    "weekly": { "description": "Days each habit was done in the last seven days", "every": "7d", "js": "…" }
  }
}
```

- **Columns:** `text`, `integer`, `real`, `boolean`, `json` and `timestamp`. A column is required unless it is `nullable` or has a `default`. An integer primary key is assigned on insert.
- **Methods** are the app's ABI:
  - A `query` reads.
  - An `action` runs in one transaction, and a throw, a broken constraint or exhausted fuel reverts all of it.
  - A method body is `sql` (one statement or a list) or `js` (a glove-js program).
- **Parameters** are declared once. They validate calls and become each method tool's JSON Schema. `:caller` and `:now` are always bound, so a method never reads the wall clock.

### The host

```ts
interface AppHost {
  list(opts: { as }): Promise<AppSummary[]>
  describe(app, opts): Promise<AppDescription>         // the owner also gets the definition, to edit
  deploy(definition, { as, migration?, dryRun? }): Promise<DeployResult>
  call(app, method, args, { as }): Promise<CallResult> // { value, events, version, deliveries? }
  events(app, { as, after?, limit? }): Promise<AppEvent[]>
  output(app, name, { as }): Promise<OutputResult>
  grant(app, { to, methods, events? }, { as }) / revoke(app, to, { as })
  remove(app, { as })
  tick({ now? }): Promise<OutputResult[]>              // run what is due
}
```

`as` is a principal string (`agent:planner`, `user:42`, `app:tasks`); the host decides the namespace. One interface has two implementations:

- `createAppHost({ backend })` runs the apps in-process.
- `remoteAppHost({ url, apiKey })` calls a host elsewhere: Kuiper, or another process running `serveMiniApps`.

Everything below takes the interface, so none of it can tell where the apps run.

### Backends

The backend adapter is small. It runs a statement, runs a block atomically, and applies structural ops. The portable parts live in the runtime above it: named parameters, key assignment, value normalisation, and the constraint checks an engine can't do.

| Backend | Storage | Atomicity | Cost of an action (`bench/actions.ts`) |
| --- | --- | --- | --- |
| `memoryBackend()` | glove-sql on the heap, `snapshot()` to bytes | dump before, restore on failure | 0.7 ms at 100 rows, 1.5 ms at 1,000, 10 ms at 5,000 |
| `sqliteBackend({ dir })` | one STRICT database file per app, or `:memory:` | `BEGIN IMMEDIATE` | 0.05–0.1 ms at every size measured |
| `postgresBackend({ pool })` | one schema per app | a transaction with `SET LOCAL search_path` | not measured |

A `js` method adds 0.3–0.5 ms for the interpreter session.

The same suite of behaviours passes on all four configurations (memory, SQLite `:memory:`, SQLite files, Postgres 16): atomicity, constraint errors, migrations with data, grants, subscriptions, outputs and restarts. Postgres runs when `MINIAPPS_TEST_DATABASE_URL` is set.

### Agent surfaces

- **Tools.** `mountMiniApps(agent, { host, as })` folds seven tools: `glove_miniapps_list`, `_describe`, `_deploy`, `_call`, `_output`, `_events` and `_share`. The deploy tool carries the worked example and the rules.
- **Per-method tools.** With `exposeMethods`, every callable method also becomes a tool, `app_<app>__<method>`. They are replaced through `replaceTools` after each deploy, so a new method is callable on the next turn.
- **Runtime context.** A context provider lists the agent's apps before each model turn: name, version, description, methods (`!` marks actions) and outputs. This is what "agents always reference their own apps" rests on. The list is read live, not written into a prompt once.
- **Working environments.** `defineTools({ name: "apps", fns: miniAppFns({ host, as }) })` gives scripts `import { invoke, list } from "env:apps"`. The same functions mount unchanged in a glove-js REPL. Deploying stays a tool: a script that redefines the app it is running against is a loop nobody wants to debug.
- **Foundry.** `defineLayer(miniAppsLayer({ host }))` mounts the tools and the context. Apps belong to `agent:<agentId>`, so they follow the agent instance from one conversation to the next. The Foundry test drives two agent runs through Foundry's agent compiler with a scripted model: the agent builds an app in the first conversation and is told about it at the start of the second.

## How this differs from working environments

| | Working environment | Mini app |
| --- | --- | --- |
| What it is | A place the agent works *in* | A thing the agent and others call |
| Lifetime | Per agent or conversation; parked as a snapshot | Durable; addressed by name |
| State | Files in a tree | Rows in declared tables |
| Code | Scripts with a default export, any shape | Named methods with declared parameters |
| Model's interface | A closed verb set (`write_file`, `run_script`, …) | Its own methods, as tools |
| Changing it | Edit files; per-file undo; checkpoints | A new version; migrations checked against the declared schema; dry runs |
| Atomicity | None across files; checkpoint by hand | Every action is a transaction |
| Who uses it | One agent | The owner, plus grantees per method, plus subscribed apps |
| Execution | Worker thread, `node:vm`, wall-clock limit | glove-js with a fuel budget, or SQL |
| Background work | None, by design | Outputs on a cadence, run by the host |
| Effects outside | Adapters mounted by the host | None. Events and outputs go to the host, which decides |

They compose rather than compete:

- **The environment is where an agent drafts.** It can try a query on a CSV in `/inbox`, then deploy the method once it works.
- **Apps are what the environment imports.** A report script reads `env:apps` into a variable and writes `/out/report.md`; the rows never enter the context window.

**Does this replace ephemeral REPL environments?** Partly. It replaces the case where an agent rebuilds the same scratch state every conversation: lists, ledgers, logs, recurring reports. It does not replace one-off work on artifacts. Turning a PDF into a deck has no schema worth declaring and nothing worth keeping. Apps make sense where the second conversation would otherwise start from nothing.

## Smart contracts: the structure, not the language

Mini apps share most of their structure with smart contracts and Durable Objects, and the prototype borrows that structure:

| Contract idea | Mini app |
| --- | --- |
| ABI | Method names and declared parameters, which become tool schemas |
| `view` vs state-changing | `query` vs `action` |
| Revert | A throw, a broken constraint or exhausted fuel rolls the whole action back |
| Gas | glove-js fuel per call (`fuel`, default 100,000) |
| `msg.sender` | `:caller` / `ctx.caller`, recorded on every event |
| `block.timestamp` | `:now` / `ctx.now`, read once per call |
| Events / logs | `_events` in the app's own database, written in the action's transaction |
| Upgrade (proxy) | A new version, with a migration checked against the declared schema |
| Compile step (`solc`) | Deploy parses every statement and program, and refuses writes from queries, unknown tables, undeclared parameters and non-portable functions |
| Single-threaded object (Durable Object) | Calls to one app run one at a time, in order |

Writing the apps themselves in Solidity (EVM) or as Solana programs is worth taking seriously. The case for it is real:

- The languages are deterministic, metered and well known.
- `revm` would embed in Kuiper's Rust.
- An app could later settle on a chain.

It loses on what agents use these apps for:

1. **Queries.** Contract storage is slots and mappings, with no iteration and no joins. "Open tasks, oldest first" needs an index the author maintains by hand. Almost every method an agent wants is a query.
2. **Migrations.** Upgrading a contract means proxy patterns and storage-layout rules a single misplaced variable breaks. Here, a migration is a list of ops the host checks against a declared schema before it runs.
3. **Text and time.** Strings are expensive and awkward, there are no floats, and outputs are mostly prose or markdown.
4. **Toolchain.** `solc` is a native binary or a multi-megabyte WASM build; Anchor needs Rust and BPF. The prototype's compile step is a parse with no toolchain, and the in-memory host runs in a browser.
5. **Fluency.** The scratchpad and glove-js benches (`benches/scratchpad-bench`) measured SQL and JavaScript as surfaces models drive well. Nothing here measures Solidity, and it is a far smaller share of what models have read.

The definition format is runtime-agnostic: a method is `sql` or `js` today. If on-chain settlement becomes a requirement, say payments between agents, an `evm` method kind run by `revm` on Kuiper fits beside them without changing the rest. The recommendation is to keep the structure, keep SQL and JS as the languages, and add an EVM runtime only when a concrete use needs one.

## In-memory execution

It works, with no dependencies beyond glove-sql and glove-js, and the root entry has no Node-only imports. glove-sql was built for analysis, not as a store, so the runtime fills four gaps:

- **Transactions.** Its `BEGIN`/`ROLLBACK` are accepted and ignored, so an action is a dump before and a restore on failure. That is the O(size) cost in the table above. It is fine for the hundreds to low thousands of rows a typical app holds; past that, use SQLite. A glove-sql copy-on-write table store would remove the cost, and is the obvious follow-up there.
- **Constraints.** It parses `NOT NULL`, `UNIQUE` and `PRIMARY KEY` and enforces none of them. After each action, the runtime checks types and constraints on the tables that action wrote.
- **ALTER TABLE.** It has none, so a column change rebuilds the table through a copy, the way SQLite documents for the ALTERs it lacks.
- **Keys.** Keys come from a per-row `max + 1` default (SQLite's rowid rule).

glove-js was already sandboxed and fuel-metered. Two things are missing:

- **Determinism.** `Date` and `Math.random` read the host, and `JsSession` cannot override globals. The prototype binds `ctx.now` and tells the model to use it. A `clock`/`random` option on `JsSessionOptions` would make methods replayable.
- **A blocked name.** `call` is a blocked member name in its sandbox, so the cross-app function is `apps.query` and the env function is `invoke`.

## Repetitive outputs

An output is a read-only `sql` or `js` computation with an optional cadence (`"every": "30m" | "6h" | "1d" | "7d"`). A string result is markdown.

- `host.tick()` runs whatever is due. `startTicker` calls it every minute, and the last run is kept in the app's `_meta`.
- A failing output counts as a run, so it waits for its next turn.
- `onOutput` is where a host delivers results.

Foundry schedules can only wake an agent with a message, so there are two ways to connect the two:

1. The process hosting the apps (Kuiper, or a Foundry server) runs the ticker and posts each output into the owner's conversation.
2. An agent schedule wakes the agent to call `glove_miniapps_output`.

The first needs no model call for a report that is a plain query, which is the reason to have outputs at all. A first-class Foundry activation kind for app outputs is the clean version of option 1. It means editing the closed unions listed in "Auto-plugging" below.

## Sharing, and the integrator

- **Grants are per method.** `host.grant("tasks", { to: "agent:reviewer", methods: ["open"] })`. A grantee sees only the methods it may call in `list` and `describe`. It never sees the definition.
- **`events: true`** lets a grantee read the event log and subscribe to it.
- **The integrator.** This is my reading of "have an integrator": the piece that wires apps to each other. An app declares `subscriptions: [{ on: "tasks.completed", run: "award" }]`. When the source action commits, the host runs the subscribed action with `caller = app:tasks`, passing the event's fields that the action declares as parameters.
  - Delivery happens after the commit, so a failed delivery never undoes the source.
  - Hops are capped (`subscriptionDepth`, default 3).
  - The subscriber's owner needs the `events` grant on the source.
- **Writes are events, reads are calls.** Inside a method, `apps.query` reads another app synchronously, but only its queries. One app never changes another directly; it emits an event the other subscribes to. That keeps an action atomic within one app, and keeps two apps that read each other from deadlocking.

"Minis share access to each other's apps" is exactly this: an agent grants another agent `open` on its tasks app and `events` on its ledger, and the other agent's app subscribes.

## Reverse matching: experiences without configuration

Not built; this is a sketch for discussion.

The usual flow is app first: someone defines a habit tracker and asks the user for data. The reverse flow starts from what is already known, such as glove-memory entities, facts and episodes, and earlier conversations. It finds the app that data implies:

1. **Templates declare what they consume.** For example, a habit tracker wants `{ habit: text, day: date }` events from a person.
2. **A matcher scores the profile against templates.** It compares entity types, fact keys and recurring episode shapes with each template's columns and parameters, by name and type, then by embedding.
3. **Above a threshold, the agent proposes the app already filled in.** "You've mentioned running on 9 of the last 14 days; I've started tracking it."
4. **The seed comes from the matched data.** `definition.seed` already exists for this.

Two pieces exist: the schema is a value that can be compared, and `seed` exists. What's missing is a template catalogue with consumption signatures, and a matcher over glove-memory. It is a natural second phase once there are a dozen real apps to learn templates from.

## Auto-plugging into Foundry

Foundry has no hook that applies to every agent. The prototype uses the `defineLayer` seam, which each agent opts into. There are two ways to make it automatic:

- **An application-level field:** `defineApplication({ miniApps: { host } })`, loaded in both processes, mounted for every agent.
- **A new installable kind,** so instances install apps the way they install tools.

Either one means editing Foundry's closed unions: `FoundryFileDefinitionKind`, `LOCAL_DEFINITION_FILES`, `FoundryAgentComponent`, the installation kind enum, and the manifest.

**Naming.** Foundry already uses "app" (`defineApp`, `.app.ts`) for integration applications such as Slack and email. Mini apps should keep the full name in code (`defineMiniApp`, `glove_miniapps_*`, a `.miniapp.ts` suffix if one is added) so the two never collide.

## Known gaps

- **Isolation on shared engines.** Method SQL is limited to the app's own tables and to functions that run the same on all three engines. That limit is portability first and isolation second.
  - On Postgres, all apps share the pool's role, so strong isolation means a role per app.
  - On SQLite, each app is its own file, which is strong isolation already.
  - Kuiper should use SQLite files.
- **Reads that don't wait their turn.** On memory and SQLite, a read that doesn't queue behind an app's running action can see that action's uncommitted rows. The one such read is another app's `apps.query`. Postgres reads get their own connection.
- **Value normalisation by name.** Result columns are normalised by matching their names against schema columns. A computed column that reuses a boolean column's name (`count(*) AS done`) can come back as a boolean.
- **Keys aren't gapless on Postgres.** Keys are unique and increasing, but Postgres keeps the keys a rolled-back action took.
- **One host per backend.** Definitions are cached in the host process, so two processes on one backend would go stale. This is the same single-writer rule as Foundry units (Kuiper R-53).
- **No rollback to a previous version.** Deploying an older definition with an inverse migration works; there is no one-step undo.
- **Not yet published or used by a real agent.** Every test is scripted, and the first real-agent run will find things.

## Open questions

1. **Ownership.** Should apps belong to the agent instance (the prototype), the workspace, or the user? Workspace-owned apps would let every agent in a workspace share one tasks app without grants.
2. **Hosting default.** Should Foundry's default be a local SQLite host under `/data`, or Kuiper-hosted apps? The first works offline; the second works across Foundry instances.
3. **EVM.** Is on-chain settlement a real requirement, or does the structure alone cover it?
4. **Outputs.** Should outputs post into conversations by default, or only when an agent subscribes?
