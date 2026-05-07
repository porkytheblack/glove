# glove-memory

Memory layer for the Glove agent framework. Storage-agnostic adapter contracts, schema-first ontology, and auto-registered tool surfaces.

## Status

Draft v0.1. **Entity memory** is implemented in this release. Episodic, resources, and context primitives are shared at the schema level (`MemorySchema.defineEpisodeKind`, `defineResourceRoot`) but their adapter contracts and tool surfaces will land in subsequent releases.

## Subsystems

- **Entity memory** — graph-shaped, schema-first, deterministic identity resolution.

## Subpath exports

| Import | Contents |
|--------|----------|
| `glove-memory` | Barrel |
| `glove-memory/core` | Shared types — `Provenance`, `Link`, `EmbeddingAdapter`, `MemorySchema`, errors |
| `glove-memory/entity` | `EntityMemoryAdapter` contract, query DSL, types |
| `glove-memory/tools` | Auto-registered read/write tool factories and `useMemoryReader` / `useMemoryCurator` helpers |
| `glove-memory/in-memory` | Reference in-process adapter for dev/test |

## Reader / curator split

Two roles, both implemented as Glove instances. The conversational reader gets read-only tools; the curator runs as an orchestrator-driven extractor with read + write tools.

```ts
import { Glove } from "glove-core";
import { MemorySchema, InMemoryEntityAdapter, useMemoryReader, useMemoryCurator } from "glove-memory";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],
    searchableProperties: ["name", "email"],
  })
  .defineRelationship({ type: "worksAt", from: "Person", to: "Organization" });

const adapter = new InMemoryEntityAdapter({ schema });

const reader = useMemoryReader(
  new Glove({ /* ... */ }),
  adapter,
).build();

const curator = useMemoryCurator(
  new Glove({ /* ... */ }),
  adapter,
).build();
```

## Reader tools

| Tool | Purpose |
|------|---------|
| `glove_memory_find` | Find nodes by class + filter, optional fuzzy |
| `glove_memory_get` | Fetch a node by id + one-hop neighbourhood |
| `glove_memory_query` | Full structured query via the query DSL |

## Curator tools

All reader tools, plus:

| Tool | Purpose |
|------|---------|
| `glove_memory_add_node` | Create or upsert a node by identity keys |
| `glove_memory_update_node` | Patch a node's properties |
| `glove_memory_connect` | Create or update an edge |
| `glove_memory_disconnect` | Remove an edge |
| `glove_memory_merge_nodes` | Fold one node into another |

## Identity behaviour

- Writes match against `identityKeys` deterministically. No fuzzy on the write path.
- If any identity key set matches an existing node, `addNode` returns that node's id with `created: false`.
- Property merging on identity hit: missing properties on the existing node are filled from the new write; conflicting properties are left untouched and the conflict is recorded in provenance.
- If two distinct existing nodes match different identity sets in the same write, the adapter throws `MemoryWriteError("identity_ambiguous")` with both IDs — orchestrator merges first, then retries.

## Reconciliation

The package's contract is deliberately narrow: store, query, write. It does **not** cascade across adapters. When an entity is merged or deleted, episodes that reference its old ID don't update on their own — orchestrators reach for the cross-adapter primitives (`replaceParticipantId`, `replaceLinkTarget`) once those subsystems land.

## What this package doesn't own

- Triggering, scheduling, or pipeline orchestration (Station's territory).
- The curation logic itself (configured by the consumer).
- Embedding *generation* — consumers plug in their own `EmbeddingAdapter`.
- Schema persistence or migration — schema lives in code; consistency across deployments is the consumer's concern.
- Cross-adapter cascade on entity merge, episode delete, or resource rename — that's reconciliation, an orchestrator responsibility.
