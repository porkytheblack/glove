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

### Simple reader — every tool on one Glove

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

### Curator composition — adapters scoped per subagent

A single curator Glove with every write tool attached works, but it's rarely the best shape. As the schema grows — more node classes, more episode kinds, more resource roots — the rendered tool descriptions grow with it, and one extractor reasoning about everything at once becomes harder to keep coherent.

The spec's recommended pattern is a parent curator that routes work to specialised subagents. Each subagent attaches **only the adapters it needs**, so its tool descriptions render only the schema slice for its role. The entity-linker never sees episode kinds; the episode-recorder gets a read-only view of entity classes (so it can resolve participant IDs) plus the episode-kind list for writes; the resource-writer gets read access to entities and episodes so it can populate `metadata.links` correctly.

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

### Same scoping for developer-defined subagents

The pattern isn't curator-specific. Any subagent the developer registers — scheduling helpers, research subagents, status reporters, anything that wants memory access — picks the slice it needs the same way. Memory tools are just adapters; the scoping rules are the same whether the subagent's job is extraction or something else entirely.

Two concrete examples on the **conversational reader** side. The main agent answers most questions itself with the small reader surface; for harder asks it delegates:

```ts
import { Glove } from "glove-core";
import {
  useContext,
  useEpisodicReader,
  useMemoryReader,
  useResourcesCurator,
} from "glove-memory";

// `scheduler` — answers "when am I free Thursday?", "what did we discuss
// with Don last week?". Pure read. Sees the user's pinned context (working
// hours, calendar prefs) and the episodic timeline. Does NOT see entity
// classes, relationships, or resource roots — irrelevant to its job.
const schedulerFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You answer scheduling and history questions. Use glove_episodic_timeline / " +
      "glove_episodic_find / glove_episodic_search to look up past meetings, and " +
      "your injected user context for working-hours preferences. Don't write to " +
      "memory — that's not your role.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  });
  glove = useEpisodicReader(glove, episodic);
  glove = useContext(glove, context);
  return glove;
};

// `researcher` — fetches external info (web tools the main agent doesn't
// have), writes notes under /research, links them to the relevant entities.
// Sees: write access to the filesystem + read access to entity ids so
// metadata.links is valid. Does NOT see episodic, does NOT see context,
// does NOT have entity-write tools.
const researcherFactory = ({ parentStore, parentControls }) => {
  let glove = new Glove({
    store: parentStore,
    model,
    displayManager: parentControls.displayManager,
    systemPrompt:
      "You research a person, organization, or topic and file notes under " +
      "/research/<slug>/. Look up entity ids via glove_memory_find first so " +
      "metadata.links references are valid. Use your fetch tool to gather " +
      "external information; summarise it as markdown.",
    compaction_config: { compaction_instructions: "..." },
    serverMode: true,
  })
    .fold({
      name: "fetch_url",
      description: "Fetch and extract text from a URL.",
      inputSchema: z.object({ url: z.string().url() }),
      async do({ url }) { /* ... */ },
    });
  glove = useMemoryReader(glove, entity);
  glove = useResourcesCurator(glove, resources);
  return glove;
};

// Main reader — small surface itself, delegates the heavier work.
const mainAgent = useContext(
  useEpisodicReader(useMemoryReader(new Glove({ /* ... */ }), entity), episodic),
  context,
)
  .defineSubAgent({ name: "scheduler", description: "Answer scheduling and history questions.", factory: schedulerFactory })
  .defineSubAgent({ name: "researcher", description: "Fetch external info and file research notes.", factory: researcherFactory })
  .build();
```

What this buys, beyond the curator-composition example:

- **The main agent's tool surface stays small.** It doesn't carry `glove_resources_write`, `glove_resources_edit`, `fetch_url`, or any of the heavier machinery. The user asking a casual question doesn't pay token cost for tools the model won't call.
- **Each subagent's mutation scope is explicit.** The scheduler is read-only across the board; the researcher writes only to the filesystem. Neither can touch the entity graph or the episodic timeline. Bugs that would show up as "agent invented a wrong entity" or "agent overwrote a meeting" are structurally impossible.
- **Different subagents see different schema slices.** The researcher's tool descriptions render the filesystem's resource-root list and the entity's node classes. The scheduler's render the episode-kind list. Neither sees the other half. A schema with twenty node classes and ten resource roots doesn't dump all thirty into every subagent's prompt.
- **Subagents can carry tools the main agent shouldn't have.** `fetch_url` lives on the researcher, not the main agent. The main agent's only path to web content is to delegate. That's a security and behaviour boundary the prompt alone couldn't enforce.

The shape generalises: any time a subagent does *X*, attach the smallest combination of `use*Reader` / `use*Curator` calls that makes *X* possible. Reader-only when it just needs to look up ids or summaries; curator when it actually needs to mutate; nothing at all when memory isn't relevant to its role.

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
