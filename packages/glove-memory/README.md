# glove-memory

Memory layer for the Glove agent framework. Storage-agnostic adapter contracts, schema-first ontology, and auto-registered tool surfaces. Four complementary, independently-usable subsystems with bring-your-own storage:

- **Entity memory** — graph-shaped, schema-first, deterministic identity resolution.
- **Episodic memory** — timeline-bound, append-only, semantically searchable.
- **Resources** — POSIX-style virtual filesystem the agent navigates with `ls` / `read` / `grep` / `glob` / `edit`.
- **Context** — user-configured ambient context, auto-injected into the system prompt every turn.

Entity, episodic, and resources use a reader / curator split — readers attach to the conversational agent, curators run as orchestrator-driven extractors. Context is different: it's user-configured rather than curator-extracted, so it uses a single registration that gives the agent both read and write tools plus system-prompt injection.

## Status

Draft v0.1. Pre-implementation scope from the spec is complete; storage backends ship as separate companion packages (`glove-memory-sqlite`, `glove-memory-postgres`) — not part of this release.

## Subpath exports

| Import | Contents |
|--------|----------|
| `glove-memory` | Barrel |
| `glove-memory/core` | Shared types — `Provenance`, `Link`, `EmbeddingAdapter`, `MemorySchema`, errors |
| `glove-memory/entity` | `EntityMemoryAdapter` contract, query DSL, types |
| `glove-memory/episodic` | `EpisodicMemoryAdapter` contract, `Episode` types, semantic-search opts |
| `glove-memory/resources` | `ResourceFsAdapter` contract, file types, POSIX path helpers |
| `glove-memory/context` | `ContextAdapter` contract, `ContextEntry` type, default markdown rendering |
| `glove-memory/tools` | Auto-registered read/write tool factories and `useMemory*` / `useEpisodic*` / `useResources*` / `useContext` helpers |
| `glove-memory/in-memory` | Reference in-process adapters for dev/test |

## Reader / curator split

Two roles, both implemented as Glove instances. The conversational reader gets read-only tools; the curator runs as an orchestrator-driven extractor with read + write tools. Context attaches once and gives the agent both read and write tools because users naturally instruct the agent to update their own context ("remember that I prefer X").

```ts
import { Glove } from "glove-core";
import {
  MemorySchema,
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
  useMemoryReader,
  useEpisodicReader,
  useResourcesReader,
  useContext,
} from "glove-memory";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],
    searchableProperties: ["name", "email"],
  })
  .defineRelationship({ type: "worksAt", from: "Person", to: "Organization" })
  .defineEpisodeKind({ name: "meeting", description: "A scheduled gathering." })
  .defineResourceRoot({ path: "/research", description: "External research artifacts." });

const entity = new InMemoryEntityAdapter({ schema });
const episodic = new InMemoryEpisodicAdapter({ schema, embedder });
const resources = new InMemoryResourcesAdapter({ schema, embedder });
const context = new InMemoryContextAdapter({ schema });

const reader = useContext(
  useResourcesReader(
    useEpisodicReader(
      useMemoryReader(
        new Glove({ /* ... */ }),
        entity,
      ),
      episodic,
    ),
    resources,
  ),
  context,
).build();
```

## Tools

### Entity reader / curator

| Tool | Purpose |
|------|---------|
| `glove_memory_find` | Find nodes by class + filter, optional fuzzy |
| `glove_memory_get` | Fetch a node by id + one-hop neighbourhood |
| `glove_memory_query` | Full structured query via the query DSL |
| `glove_memory_add_node` | Create or upsert a node by identity keys *(curator)* |
| `glove_memory_update_node` | Patch a node's properties *(curator)* |
| `glove_memory_connect` | Create or update an edge *(curator)* |
| `glove_memory_disconnect` | Remove an edge *(curator)* |
| `glove_memory_merge_nodes` | Fold one node into another *(curator)* |

### Episodic reader / curator

| Tool | Purpose |
|------|---------|
| `glove_episodic_search` | Semantic search over episode content *(only registered when adapter advertises `supportsSemanticSearch`)* |
| `glove_episodic_find` | Structured filter — by kind, participant, time range, properties |
| `glove_episodic_timeline` | Chronological listing for an entity or time window |
| `glove_episodic_record` | Append a new episode *(curator)* |
| `glove_episodic_update` | Patch an existing episode *(curator)* |
| `glove_episodic_delete` | Remove an episode *(curator)* |

### Resources reader / curator

| Tool | Purpose |
|------|---------|
| `glove_resources_ls` | List directory contents |
| `glove_resources_read` | Read a file body, with optional line range |
| `glove_resources_stat` | Get metadata about a single path |
| `glove_resources_grep` | Text/regex search across the tree |
| `glove_resources_glob` | Find paths by name pattern |
| `glove_resources_search` | Semantic search *(only registered when adapter advertises `supportsSemanticSearch`)* |
| `glove_resources_links_for` | Reverse-lookup: find resources linking to a target |
| `glove_resources_write` | Create or overwrite a file *(curator)* |
| `glove_resources_edit` | Replace a unique substring *(curator)* |
| `glove_resources_mkdir` | Create an empty directory *(curator)* |
| `glove_resources_move` | Rename or relocate *(curator)* |
| `glove_resources_remove` | Delete a file or directory *(curator)* |
| `glove_resources_set_metadata` | Patch metadata without rewriting body *(curator)* |

### Context

| Tool | Purpose |
|------|---------|
| `glove_context_get` | Read entries by section or list all |
| `glove_context_set` | Add a new entry |
| `glove_context_update` | Patch an existing entry in place |
| `glove_context_unset` | Remove an entry or wipe an entire section |

## System-prompt injection (context)

`useContext` wraps `Glove.processRequest`. On every turn it calls `adapter.render()` to materialise pinned entries as a markdown block, then composes `<base systemPrompt>` + `\n\n` + `<rendered context>` and calls `setSystemPrompt`. Pinned context goes **after** the developer's system prompt — developer prompt sets agent character and guardrails; user context modifies engagement for this specific user. Re-rendering happens every turn, so external updates the user made between turns are reflected immediately.

## Embedding lifecycle

Episodic and resources adapters generate embeddings out-of-band. Writes mark records `embeddingStatus: "missing"` (initial) or `"stale"` (content change) and return immediately. A separate process — typically a Station signal — picks them up via `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding`, calls the configured `EmbeddingAdapter`, and writes vectors back via `setEmbedding`.

The `EmbeddingAdapter` contract is intentionally tiny — consumers plug in whatever provider they want without the package taking on a model dependency.

### Implementation choices in the in-memory adapters

- **Stale marking is content-only on episodes.** `updateEpisode` flips `embeddingStatus: "stale"` and drops the cached vector only when the `content` field changes — kind / participant / property / occurredAt patches don't re-embed. The embedding represents `content`; the spec is silent on the others. Consumers wanting different behavior can delete + re-record.
- **Recency blend uses a 30-day half-life.** `searchEpisodes` ranks by `(1 - recencyWeight) * semanticScore + recencyWeight * recencyScore` where `recencyScore = exp(-ln(2) * ageMs / halfLifeMs)`, `halfLifeMs = 30 days`. Default `recencyWeight = 0.2`. Companion adapters (sqlite/postgres) may pick different curves; only the shape of the blend is fixed by the spec.

## Reconciliation

The package's contract is deliberately narrow: store, query, write, search. It does **not** cascade across adapters. When an entity is merged or deleted, episodes that reference its old ID don't update on their own. Orchestrators reach for the cross-adapter primitives:

| Action | Primitive |
|--------|-----------|
| Entity merged | `episodic.replaceParticipantId(oldId, newId, prov)`, `resources.replaceLinkTarget("entity", oldId, newId, prov)` |
| Entity deleted | `episodic.findEpisodes({ where: { participantIds: [id] } })`, `resources.linksFor("entity", id)` then orchestrator decides |
| Resource moved | `resources.replaceLinkTarget("resource", fromPath, toPath, prov)` |
| Episode deleted | `resources.linksFor("episode", id)` then orchestrator decides |
| Stale embeddings | `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding` → embed → `setEmbedding` |

## What this package doesn't own

- Triggering, scheduling, or pipeline orchestration (Station's territory).
- The curation logic itself (configured by the consumer).
- Embedding *generation* — consumers plug in their own `EmbeddingAdapter`.
- Schema persistence or migration — schema lives in code; consistency across deployments is the consumer's concern.
- Cross-adapter cascade on entity merge, episode delete, or resource rename — that's reconciliation, an orchestrator responsibility.
- The user-side write path for context — the adapter exposes `set` / `update` / `unset`; the UI / API / form / wherever users edit their preferences calls those directly.
- Binary resources. Resources is text-only.
- `.` and `..` path resolution. All paths are absolute.
