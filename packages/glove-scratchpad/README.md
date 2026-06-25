# glove-scratchpad

**The Scratchpad Computer for Glove** — a substrate-independent architecture for
context-efficient multi-agent workflows.

The context savings usually attributed to "code execution for MCP" come from two
mechanisms that have nothing to do with a Linux shell:

1. **Interface disclosure** — not loading every tool schema at once.
2. **Result containment** — not round-tripping intermediate tool *results*
   through the model.

Neither needs a terminal or a VM. The first is **graph partitioning** (give each
subagent only the tools its node needs — Glove subagents + `glove-mcp` discovery
already do this, and the [subagent graph](#subagent-graphs) below makes it
declarative). The second is **handles + deterministic transforms over a durable
store** — which is what this package provides:

> A tool's full result is written into a durable store and only a **stub**
> (reference + descriptor + "read more") crosses back into the model's context.
> Agents then **narrow deterministically in SQL**, pass **references** (not
> payloads) downstream, and **materialize** real values only at the last mile.

The manipulation surface is a **defined Postgres subset** (the standard); the
backend behind it is swappable. The default is a **zero-dependency, pure-JS
Postgres-subset emulator** (`MemoryBackend`) whose tables are constructed at
runtime from whatever data is ingested — no WASM, no native module, runs
anywhere JS does. A PGlite (WASM Postgres) backend is available on an opt-in
subpath when a full Postgres dialect is wanted.

```
naive (full payload in context):        142,354 b
scratchpad (stub + stub + last mile):     3,789 b   →  37.6× less
```

(from `pnpm scratchpad:demo` — no API key, no database, no dependencies)

---

## Install

```bash
pnpm add glove-scratchpad
# that's it — the default backend is pure JS with zero runtime dependencies.

# OPTIONAL: only if you want the PGlite (WASM Postgres) backend instead:
pnpm add @electric-sql/pglite
```

## Quick start

```ts
import { Scratchpad, MemoryBackend, mountScratchpad, storeAndTruncate } from "glove-scratchpad";

// 1. One durable store per unit of work, behind the Postgres-subset contract.
const sp = await Scratchpad.create(await MemoryBackend.create());

// 2. Contain a chunky tool's result: payload → store, stub → context.
agent.fold(storeAndTruncate(bigTool, { scratchpad: sp }));

// 3. Give the agent the manipulation surface + restraint priming.
mountScratchpad(agent, { scratchpad: sp });
```

Now the agent works the data through `scratchpad_describe` → `scratchpad_query`
→ `scratchpad_materialize` instead of reading the whole payload.

---

## The moving parts

| Concept (design)         | Code                                                    |
| ------------------------ | ------------------------------------------------------- |
| Durable store / membrane | `Scratchpad` (`glove-scratchpad/core`)                  |
| Manipulation surface     | Postgres-dialect SQL via `ScratchpadBackend`            |
| Default backend          | `MemoryBackend` — pure-JS, zero-dep, runtime-built      |
| Result containment       | `storeAndTruncate(tool, { scratchpad })`                |
| Descriptor economy       | `Descriptor` = `{ value, schema, preview, provenance }` |
| Last-mile discipline     | `mountScratchpad` priming + `scratchpad_materialize`    |
| Computation as a value   | `Scratchpad.snapshot()` / `MemoryBackend.create({ load })` |
| Subagent topology        | `buildScratchpadGraph(def, …)` (`glove-scratchpad/graph`) |
| Workflow execution       | `runScratchpadGraph` · the `workflow_run` (build + run) tool |

### Store-and-truncate (result containment)

`storeAndTruncate` is generic over any Glove tool (`GloveFoldArgs`), not coupled
to MCP. It runs the wrapped tool, ingests a successful payload into the store,
and returns a compact stub as the model-facing `data` while preserving the
original payload on `renderData` (client-only). Compose it with `glove-mcp`:

```ts
import { bridgeMcpTool } from "glove-mcp";
glove.fold(storeAndTruncate(bridgeMcpTool(conn, tool, serverMode), { scratchpad: sp }));
```

Storing is a **side effect of a tool returning**, never an agent action — the
adapter owns ingestion, key allocation, normalization, and lifecycle.

### First-level normalization

On ingest, a JSON value is normalized once (§7):

- scalar fields → typed **columns** of the root table (named by the reference);
- nested arrays → **child tables** joined on `_parent = _rid`, ordered by `_idx`;
- anything deeper (nested objects, mixed scalars) → a **`jsonb`** column,
  reachable in place via `->` / `->>`.

Depth-1 is the same pass run once; deeper nesting is never out of reach, so
stopping here is an ergonomics choice, not a capability gate.

### The descriptor economy

A reference does **not** resolve to a blob. It resolves to a `Descriptor`:
columns + types, row count, a bounded preview, child-table layout, and
provenance. Agents plan against this and touch values only by a deliberate
`materialize`. The descriptor is the real interface — rich enough to plan
without peeking, so agents don't materialize *defensively*.

### Reading is universal; restraint is the default

Every subagent *can* read. The system works because they're **primed** to defer
materialization to the last mile, and because the stub leads with a rich
descriptor while the payload sits one deliberate step behind a handle — the
cheap, obvious move is to reason over the descriptor. Priming sets the
disposition; the return shape makes it hold (`SCRATCHPAD_PREAMBLE`).

### Computation as a value

`Scratchpad.snapshot()` serializes the entire store to bytes;
`MemoryBackend.create({ load })` brings it back to life. A scratchpad is a value
you can tear down and resume. (`MemoryBackend` snapshots to compact JSON; the
PGlite dump carries Postgres's base data-dir overhead instead.)

---

## Backends

The Scratchpad emits a **defined Postgres subset** and never knows what is
backing it (§6.1 *"the dialect is the standard; the backend is an implementation
detail"*). Two backends ship:

### `MemoryBackend` (default) — `glove-scratchpad` / `glove-scratchpad/memory`

A **zero-dependency, pure-JS Postgres-subset emulator**. It is an in-memory
store whose tables are *constructed at runtime* from whatever data is ingested
(no fixed schema), with a small SQL engine — tokenizer → recursive-descent
parser → evaluator — that runs exactly the subset the Scratchpad and its agents
use:

- **DDL** — `CREATE TABLE [IF NOT EXISTS]`, `CREATE TABLE … AS <select>`,
  `DROP TABLE [IF EXISTS] … [CASCADE]`
- **DML** — `INSERT … VALUES (…), (…)`, `DELETE … [WHERE …]` (with `$n` params)
- **Query** — `SELECT [DISTINCT]` from tables, subqueries, or
  `information_schema.columns`; `INNER` / `LEFT JOIN … ON`; `WHERE`, `GROUP BY`,
  `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`; `WITH` (CTEs); aggregates
  (`count` / `sum` / `avg` / `min` / `max`); jsonb access via `->` / `->>`; and
  `::type` casts.

Anything outside the subset throws a clear error rather than silently
mis-answering. The whole store serializes to bytes (`dump()`) and is
reconstructed via `MemoryBackend.create({ load })` — computation as a value with
none of Postgres's data-dir overhead.

```ts
import { MemoryBackend } from "glove-scratchpad";          // (also on /memory)
const sp = await Scratchpad.create(await MemoryBackend.create());
```

### `PgliteBackend` (optional) — `glove-scratchpad/pglite`

A real embedded Postgres (WASM) — full dialect, real `jsonb`, a serializable
data dir. `@electric-sql/pglite` is an **optional peer dependency**; install it
only if you use this backend. Reach for it when you need SQL beyond the emulated
subset (window functions, `jsonb_array_elements`, complex CTEs, …).

```ts
import { PgliteBackend } from "glove-scratchpad/pglite";
const sp = await Scratchpad.create(await PgliteBackend.create());
```

**Bring your own.** Implement `ScratchpadBackend` over anything that speaks the
subset — real Postgres over a pool, SQLite, a remote service.

---

## Subagent graphs

`glove-scratchpad/graph` turns a **plain, schema-validated object** into a wired
multi-subagent topology. The object is the contract — subagents, their prompts,
the tool slice each one sees, and the edges between them. The adapter does the
construction the definition implies.

```ts
import { buildScratchpadGraph, type GraphDef } from "glove-scratchpad/graph";

const def: GraphDef = {
  name: "triage",
  entry: "planner",
  subagents: [
    {
      name: "planner",
      prompt: "Plan the triage. Narrow in SQL; hand a reference to the reader.",
      tools: ["issues__search"],          // its capability slice (interface disclosure)
    },
    {
      name: "reader",
      prompt: "Read the narrowed reference and write the summary.",
      defaultLimit: 20,
    },
  ],
  edges: [{ from: "planner", to: "reader", when: "after narrowing" }],
};

const graph = await buildScratchpadGraph(def, {
  scratchpad: sp,
  tools: { issues__search: searchTool },  // registry the slices are drawn from
  // You own construction (model/store/display); the adapter owns wiring.
  createAgent: (spec) =>
    new Glove({ model, displayManager, systemPrompt: spec.prompt, /* … */ }).build(),
});

graph.entry;                 // the planner node
graph.next("planner");       // [ reader ]  — successors via edges
graph.get("reader").runnable // the wired IGloveRunnable
```

For each subagent the adapter:

1. validates the definition (shape + unique names + entry/edge endpoints exist);
2. builds the runnable via your `createAgent` factory;
3. sets its system prompt from `spec.prompt`;
4. folds its **tool slice** from the `tools` registry (unknown name → error);
5. mounts the scratchpad surface + restraint priming, stamping
   `actor = spec.name` so provenance records who produced what;
6. returns a navigable graph (`nodes`, `edges`, `entry`, `get`, `next`).

The Zod schema (`graphSchema`) is the source of truth; the TS types are inferred
from it, so a definition that type-checks is one that validates at runtime. Use
`parseGraphDef(obj)` to validate without building.

### Running a workflow

`runScratchpadGraph(graph, { objective })` executes the wired graph to an answer.
Starting at the entry subagent it walks the edges in dependency order, threading
each node's output to its downstream neighbours and letting every node work the
**shared scratchpad** (narrow in SQL, store references) as it goes. Only the
objective, short upstream notes, and the list of references that exist ride in
the handoff — never the data. The terminal subagent reads what it needs and
returns the resolved answer.

```ts
import { runScratchpadGraph } from "glove-scratchpad/graph";

const { answer, resolved, steps, refs } = await runScratchpadGraph(graph, {
  objective: "How many open issues are there, by priority?",
});
```

### As one tool the agent drives

Most of the time you don't want to author the graph in code — you want the agent
to. `mountWorkflow` folds a **single** tool, `workflow_run`, that builds and runs
a workflow in one call: the model hands it the definition + an objective, and it
constructs the subagents and runs them to a resolved answer.

```ts
import { mountWorkflow } from "glove-scratchpad/graph";

mountWorkflow(agent, {
  scratchpad: sp,
  tools: { issues__search: searchTool },     // the slices subagents may draw from
  createAgent: (spec) =>                      // you own construction…
    new Glove({ model, displayManager, systemPrompt: spec.prompt, /* … */ }).build(),
});
// …the model now calls, in one shot:
//   workflow_run({ entry, subagents, edges, objective })
// → { answer, resolved, refs, topology, steps }
```

(`workflowTool(opts)` returns it unmounted; `buildAndRunScratchpadGraph(def, { …, objective })`
is the programmatic equivalent.)

Routing is dependency-ordered (a DAG); each reachable node runs once after its
predecessors, with a `maxSteps` guard for cycles. Conditional routing (acting on
an edge's `when`) is a deliberate non-goal for now — edges are unconditional
handoffs.

See `pnpm scratchpad:graph` (construction) and `pnpm scratchpad:workflow`
(create → run → answer) for runnable, no-API-key walkthroughs.

---

## API

### `Scratchpad` (`glove-scratchpad/core`)

```ts
const sp = await Scratchpad.create(backend);

await sp.ingest(value, { name?, provenance?, previewRows? });       // → Stub
await sp.describe(ref, previewRows?);                               // → Descriptor
await sp.query(sql, { store?, limit?, previewRows?, provenance? }); // → Stub | { rows, truncated }
await sp.materialize({ ref?, sql?, limit?, offset? });              // → { rows, returned, truncated }
await sp.list();                                                    // → record summaries (no previews)
await sp.drop(ref);
await sp.snapshot();                                                // → Uint8Array
```

- `query` with `store` runs `CREATE TABLE AS` and returns a **stub** for the new
  reference (the "narrow → store → narrow again" loop). Without `store` it runs a
  read-only `SELECT` / `WITH` and returns **bounded rows**.
- `materialize` is the only path that returns full values; bounded by `limit`,
  paged by `offset`.

### Tools (`glove-scratchpad/tools`)

- `mountScratchpad(glove, { scratchpad, actor?, defaultLimit?, prime? })` — folds
  the four surface tools and prepends `SCRATCHPAD_PREAMBLE` (unless `prime:false`).
- Surface tools folded: `scratchpad_describe`, `scratchpad_query`,
  `scratchpad_materialize`, `scratchpad_list`.
- `storeAndTruncate(tool, { scratchpad, actor?, name?, minBytes?, keepRenderData? })`.

### Graph (`glove-scratchpad/graph`)

- `buildScratchpadGraph(def, { scratchpad, createAgent, tools?, mountScratchpad? })`
  → `ScratchpadGraph`.
- `runScratchpadGraph(graph, { objective, maxSteps?, signal?, onStep? })`
  → `{ answer, resolved, steps, refs }`.
- `buildAndRunScratchpadGraph(def, { …, objective, maxSteps? })`
  → `{ graph, result }` — build + run in one call.
- `mountWorkflow(glove, { scratchpad, createAgent, tools?, ... })` — folds the
  single `workflow_run` tool (build + run) so the model authors and runs
  workflows itself. `workflowTool(...)` returns it unmounted.
- `parseGraphDef(obj)` → validated `GraphDef`. `graphSchema` / `subagentSchema` /
  `edgeSchema` are the Zod schemas.

### Backend contract (`ScratchpadBackend`)

```ts
interface ScratchpadBackend {
  query(sql: string, params?: unknown[]): Promise<BackendResult>;
  exec(sql: string): Promise<void>;
  dump(): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

Implement it over anything that speaks the Postgres subset. `MemoryBackend`
(default, zero-dep) and `PgliteBackend` (`glove-scratchpad/pglite`) both satisfy
it — the same `Scratchpad` code path runs unchanged on either.

---

## Invariants

- Storing is a **side effect of a tool returning**, never an agent action.
- Agents pass **references, schemas, and unevaluated queries** — not payloads.
- A key resolves to **`{value, schema, preview, provenance}`**, never a bare blob.
- **No transparent materialization** — every value entering context is an
  explicit, budgeted load.
- The contract is a **defined Postgres subset**; the backend is swappable.
- Normalize to **first level**; deeper nesting stays in `jsonb`, reachable in place.
- **Every** subagent can read; **all** are primed to defer to the last mile.

## Status

Draft v0.1 — a working vertical slice of the architecture. The default backend
covers the SQL subset the Scratchpad and its agents use; the empirical "how small
a SQL surface covers what fraction of real MCP transforms" question (the closure
knee) is left open by design — when a workflow outgrows the subset, swap in
`PgliteBackend` and keep the same code.

## License

MIT
