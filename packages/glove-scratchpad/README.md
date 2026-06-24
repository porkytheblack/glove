# glove-scratchpad

**The Scratchpad Computer for Glove** — a substrate-independent architecture for
context-efficient multi-agent workflows.

The context savings usually attributed to "code execution for MCP" come from two
mechanisms that have nothing to do with a Linux shell:

1. **Interface disclosure** — not loading every tool schema at once.
2. **Result containment** — not round-tripping intermediate tool *results*
   through the model.

Neither needs a terminal or a VM. The first is **graph partitioning** (give each
subdroid only the tools its node needs — Glove subagents + `glove-mcp` discovery
already do this). The second is **handles + deterministic transforms over a
durable store** — which is what this package provides:

> A tool's full result is written into a durable store and only a **stub**
> (reference + descriptor + "read more") crosses back into the model's context.
> Agents then **narrow deterministically in SQL**, pass **references** (not
> payloads) downstream, and **materialize** real values only at the last mile.

The manipulation surface is a **defined Postgres subset** (the standard); the
backend behind it is swappable (the shipped `PgliteBackend`, real Postgres, or an
emulator over a plain object).

```
naive (full payload in context):        142,354 b
scratchpad (stub + stub + last mile):     3,789 b   →  37.6× less
```

(from `pnpm scratchpad:demo` — no API key required)

---

## Install

```bash
pnpm add glove-scratchpad
# the reference backend is an optional peer dependency:
pnpm add @electric-sql/pglite
```

## Quick start

```ts
import { Scratchpad, mountScratchpad, storeAndTruncate } from "glove-scratchpad";
import { PgliteBackend } from "glove-scratchpad/pglite";

// 1. One durable store per unit of work, behind the Postgres-subset contract.
const sp = await Scratchpad.create(await PgliteBackend.create());

// 2. Contain a chunky tool's result: payload → store, stub → context.
agent.fold(storeAndTruncate(bigTool, { scratchpad: sp }));

// 3. Give the agent the manipulation surface + restraint priming.
mountScratchpad(agent, { scratchpad: sp });
```

Now the agent works the data through `scratchpad_describe` → `scratchpad_query`
→ `scratchpad_materialize` instead of reading the whole payload.

---

## The four moving parts

| Concept (design)        | Code                                              |
| ----------------------- | ------------------------------------------------- |
| Durable store / membrane | `Scratchpad` (`glove-scratchpad/core`)            |
| Manipulation surface     | Postgres-dialect SQL via `ScratchpadBackend`      |
| Result containment       | `storeAndTruncate(tool, { scratchpad })`          |
| Descriptor economy       | `Descriptor` = `{ value, schema, preview, provenance }` |
| Last-mile discipline     | `mountScratchpad` priming + `scratchpad_materialize` |
| Computation as a value   | `Scratchpad.snapshot()` / `PgliteBackend.create({ load })` |

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
  reachable in place via `->` / `->>` / `jsonb_array_elements`.

Depth-1 is the same pass run once; deeper nesting is never out of reach, so
stopping here is an ergonomics choice, not a capability gate.

### The descriptor economy

A reference does **not** resolve to a blob. It resolves to a `Descriptor`:
columns + types, row count, a bounded preview, child-table layout, and
provenance. Agents plan against this and touch values only by a deliberate
`materialize`. The descriptor is the real interface — rich enough to plan
without peeking, so agents don't materialize *defensively*.

### Reading is universal; restraint is the default

Every subdroid *can* read. The system works because they're **primed** to defer
materialization to the last mile, and because the stub leads with a rich
descriptor while the payload sits one deliberate step behind a handle — the
cheap, obvious move is to reason over the descriptor. Priming sets the
disposition; the return shape makes it hold (`SCRATCHPAD_PREAMBLE`).

### Computation as a value

`Scratchpad.snapshot()` serializes the entire store to bytes;
`PgliteBackend.create({ load })` brings it back to life. A scratchpad is a value
you can tear down and resume. (The PGlite dump carries Postgres's base data-dir
overhead; a lighter backend snapshots smaller.)

---

## API

### `Scratchpad` (`glove-scratchpad/core`)

```ts
const sp = await Scratchpad.create(backend);

await sp.ingest(value, { name?, provenance?, previewRows? });      // → Stub
await sp.describe(ref, previewRows?);                              // → Descriptor
await sp.query(sql, { store?, limit?, previewRows?, provenance? }); // → Stub | { rows, truncated }
await sp.materialize({ ref?, sql?, limit?, offset? });             // → { rows, returned, truncated }
await sp.list();                                                   // → record summaries (no previews)
await sp.drop(ref);
await sp.snapshot();                                               // → Uint8Array
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

### Backend contract (`ScratchpadBackend`)

```ts
interface ScratchpadBackend {
  query(sql: string, params?: unknown[]): Promise<BackendResult>;
  exec(sql: string): Promise<void>;
  dump(): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

Implement it over anything that speaks the Postgres subset. The shipped
`PgliteBackend` (`glove-scratchpad/pglite`) is one reference implementation.

---

## Invariants

- Storing is a **side effect of a tool returning**, never an agent action.
- Agents pass **references, schemas, and unevaluated queries** — not payloads.
- A key resolves to **`{value, schema, preview, provenance}`**, never a bare blob.
- **No transparent materialization** — every value entering context is an
  explicit, budgeted load.
- The contract is a **defined Postgres subset**; the backend is swappable.
- Normalize to **first level**; deeper nesting stays in `jsonb`, reachable in place.
- **Every** subdroid can read; **all** are primed to defer to the last mile.

## Status

Draft v0.1 — a working vertical slice of the architecture. The empirical "how
small a SQL surface covers what fraction of real MCP transforms" question (the
closure knee) is left open by design.

## License

MIT
