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

## Architecture

Two roles, both implemented as Glove instances. The conversational **reader** answers user questions and pulls in memory when context demands it. The **curator** runs as an orchestrator-driven extractor with write access. Context attaches once on the conversational side and gives the agent both read and write tools because users naturally instruct the agent to update their own context ("remember that I prefer X").

### Recommended: don't attach memory tools to your main Glove

**If you're building an agent that needs memory access, we advise against attaching the entity / episodic / resources tools directly to your main Glove instance.** Build subagents — one per retrieval task — and register them on the main agent. Each subagent attaches **only the adapter slice it needs**; the main agent stays small and routes to the right subagent based on what the user asked for.

Why:

- **Bounded prompt surface.** The main agent's tool descriptions don't render every node class, every relationship, every episode kind, and every resource root on every turn. Each subagent renders only the schema slice for its role. Token cost scales with role, not with total ontology size.
- **Sharper routing.** Subagent names and descriptions are themselves part of the model's reasoning surface. "When the user asks about a person, route to `lookup`" is a tighter signal than "you have these eight memory tools, decide which to call."
- **Mutation scope is explicit.** A retrieval subagent attached with `useMemoryReader` *cannot* write — the affordance isn't there. The main agent never has to be told "don't accidentally create entities mid-conversation"; it structurally can't.
- **Adapters are still shared.** All subagents read and write to the same underlying graph, timeline, and filesystem. Splitting **memory** across subagents would defeat the point; splitting **tools** does not.

The exception is `useContext`. Context is small (4 tools), user-driven ("remember that…"), and ships with the system-prompt-injection wrapper that has to live on the agent the user actually talks to. Keep `useContext` on the main agent.

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
  .defineNodeClass({
    name: "Organization",
    schema: z.object({ name: z.string(), domain: z.string().optional() }),
    identityKeys: [["domain"], ["name"]],
    searchableProperties: ["name"],
  })
  .defineRelationship({ type: "worksAt", from: "Person", to: "Organization" })
  .defineEpisodeKind({ name: "meeting", description: "A scheduled gathering." })
  .defineResourceRoot({ path: "/research", description: "External research artifacts." })
  .defineResourceRoot({ path: "/transcripts", description: "Meeting transcripts." });

const entity = new InMemoryEntityAdapter({ schema });
const episodic = new InMemoryEpisodicAdapter({ schema, embedder });
const resources = new InMemoryResourcesAdapter({ schema, embedder });
const context = new InMemoryContextAdapter({ schema });

// `lookup` — answers "who is Don?", "what do you know about Acme?". Sees
// only the entity graph; doesn't render episode kinds or resource roots.
const lookupFactory = ({ parentStore, parentControls }) =>
  useMemoryReader(
    new Glove({
      store: parentStore,
      model,
      displayManager: parentControls.displayManager,
      systemPrompt:
        "You answer factual questions about people, organizations, and their " +
        "relationships. Use glove_memory_find for fuzzy lookups, glove_memory_get " +
        "for one-hop neighbourhoods, glove_memory_query for deeper traversal.",
      compaction_config: { compaction_instructions: "..." },
      serverMode: true,
    }),
    entity,
  );

// `recall` — answers "what did we discuss with Don last week?", "what
// happened on the Q3 launch?". Reads episodes; reads entity for resolving
// names to ids.
const recallFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You answer questions about past events. Resolve participant names to " +
      "ids via glove_memory_find first, then use glove_episodic_timeline / " +
      "glove_episodic_find / glove_episodic_search depending on whether the " +
      "user asked about a specific person, a window, or a topic.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicReader(glove, episodic);
  return glove;
};

// `find-notes` — answers "what notes do we have on Aptos regulation?".
// Browses the filesystem; reads entity for "notes about <person>".
const findNotesFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You find research notes, transcripts, and link collections in the " +
      "resource filesystem. Use glove_resources_grep / _glob / _search to " +
      "locate files; glove_resources_read to fetch their contents. When the " +
      "user asks for notes about a specific person or organization, look up " +
      "the entity id first and use glove_resources_links_for to find " +
      "everything that links to it.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useResourcesReader(glove, resources);
  return glove;
};

// Main agent — keeps useContext for the system-prompt injection and the
// small "remember that..." tool surface, but offloads every other memory
// task to a subagent.
const main = useContext(new Glove({ /* ... */ }), context)
  .defineSubAgent({ name: "lookup", description: "Look up people, organizations, and their relationships.", factory: lookupFactory })
  .defineSubAgent({ name: "recall", description: "Recall past meetings, decisions, and events.", factory: recallFactory })
  .defineSubAgent({ name: "find-notes", description: "Find research notes, transcripts, and links.", factory: findNotesFactory })
  .build();
```

The shape generalises: any subagent the developer registers — for any role, not just memory access — picks the smallest combination of `use*Reader` / `use*Curator` calls that makes its job possible. Reader-only when it's just resolving ids or summaries; curator when it actually needs to mutate; nothing at all when memory isn't relevant.

### Curator composition — same pattern on the write side

The same advice applies to the curator. A parent curator that routes to specialised write-side subagents — entity-linker, episode-recorder, resource-writer — is preferable to a single curator with every write tool attached. Each subagent attaches **only the adapters it needs**, so its tool descriptions render only the schema slice for its role. The entity-linker never sees episode kinds; the episode-recorder gets a read-only view of entity classes (so it can resolve participant IDs) plus the episode-kind list for writes; the resource-writer gets read access to entities and episodes so it can populate `metadata.links` correctly.

Schema rendering is naturally bounded by role rather than by total ontology size:

```ts
import { Glove } from "glove-core";
import {
  useMemoryCurator,
  useMemoryReader,
  useEpisodicCurator,
  useEpisodicReader,
  useResourcesCurator,
} from "glove-memory";

// Subagents share the parent's adapters — there's no per-subagent memory
// namespace. What one subagent writes, the next can immediately read.
//
// Each factory builds a fresh Glove with a focused system prompt and only
// the tools its role needs. The factory pattern is `glove-core`'s standard
// `defineSubAgent({ name, factory })`.

const linkerFactory = ({ parentStore, parentControls }) =>
  // Sees: node classes, relationships. NOT episode kinds, NOT resource roots.
  useMemoryCurator(
    new Glove({
      store: parentStore,
      model,
      displayManager: parentControls.displayManager,
      systemPrompt:
        "You extract entities and relationships from the conversation slice you receive. " +
        "Use addNode (which dedups via identity keys) for entities, and connect for " +
        "relationships. If addNode returns identity_ambiguous, merge the matched ids " +
        "first, then retry.",
      compaction_config: { compaction_instructions: "..." },
      serverMode: true,
    }),
    entity,
  );

const recorderFactory = ({ parentStore, parentControls }) => {
  // Sees: episode kinds (for writes) + read-only entity classes (to resolve
  // participant ids). Does NOT see resource roots.
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You record episodes from the conversation slice you receive. " +
      "Look up participant entity ids via glove_memory_find before calling " +
      "glove_episodic_record. Pick a registered kind from the list in the " +
      "record-tool description.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicCurator(glove, episodic);
  return glove;
};

const filerFactory = ({ parentStore, parentControls }) => {
  // Sees: resource roots + read-only entities and episodes (so metadata.links
  // points at real ids). Does NOT see write tools for entity / episodic.
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You file research notes, transcripts, and link collections under the " +
      "registered resource roots. Use glove_memory_find / glove_episodic_find " +
      "to resolve link target ids before writing, so metadata.links references " +
      "are valid.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useMemoryReader(glove, entity);
  glove = useEpisodicReader(glove, episodic);
  glove = useResourcesCurator(glove, resources);
  return glove;
};

// The parent curator owns no memory tools itself — it just routes. Its job
// is reading the conversation slice and dispatching to the right subagent
// in sequence (classify -> link -> record -> file).
const curator = new Glove({
  store: curatorStore,
  model,
  displayManager: headlessDisplayManager,
  systemPrompt:
    "You orchestrate memory extraction from conversation history. Route work " +
    "to your subagents in sequence: linker (entities + relationships), recorder " +
    "(episodes), filer (resources). Each subagent only sees the slice of the " +
    "schema relevant to its role.",
  compaction_config: { compaction_instructions: "..." },
  serverMode: true,
})
  .defineSubAgent({ name: "linker", description: "Extract entities and relationships.", factory: linkerFactory })
  .defineSubAgent({ name: "recorder", description: "Record episodes; resolves participant ids first.", factory: recorderFactory })
  .defineSubAgent({ name: "filer", description: "File research artifacts; resolves link targets first.", factory: filerFactory })
  .build();
```

Why this beats one Glove with everything attached:

- **Bounded prompt surface per role.** The recorder's `glove_memory_find` description renders entity classes; it doesn't render relationships, episode kinds, or resource roots. The filer's tool descriptions render resource roots without rendering write tools for entity. Token cost scales with role, not with total schema size.
- **Tighter system prompt per role.** Each subagent has a focused brief. The linker isn't tempted to write episodes; the recorder isn't tempted to invent new resource paths.
- **Read-only access where appropriate.** The recorder needs entity *ids* to populate `participants`, not the ability to create entities. Attaching `useMemoryReader` rather than `useMemoryCurator` removes that affordance entirely.
- **Adapters are shared.** All three subagents read and write to the same underlying graph, timeline, and filesystem. The linker's `addNode` becomes immediately visible to the recorder's `find`. Splitting memory across subagents would defeat the point of sequencing them.

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

Episodic and resources adapters generate embeddings out-of-band. Writes mark records `embeddingStatus: "missing"` (initial) or `"stale"` (content change) and return immediately. A separate process — typically a [Station](https://station.dterminal.net) signal — picks them up via `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding`, calls the configured `EmbeddingAdapter`, and writes vectors back via `setEmbedding`.

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

- Triggering, scheduling, or pipeline orchestration ([Station](https://station.dterminal.net)'s territory).
- The curation logic itself (configured by the consumer).
- Embedding *generation* — consumers plug in their own `EmbeddingAdapter`.
- Schema persistence or migration — schema lives in code; consistency across deployments is the consumer's concern.
- Cross-adapter cascade on entity merge, episode delete, or resource rename — that's reconciliation, an orchestrator responsibility.
- The user-side write path for context — the adapter exposes `set` / `update` / `unset`; the UI / API / form / wherever users edit their preferences calls those directly.
- Binary resources. Resources is text-only.
- `.` and `..` path resolution. All paths are absolute.
