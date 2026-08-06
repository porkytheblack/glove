# glove-memory

Memory layer for the Glove agent framework. Storage-agnostic adapter contracts, schema-first ontology, and auto-registered tool surfaces. Five complementary, independently-usable subsystems with bring-your-own storage:

- **Entity memory** — graph-shaped, schema-first, deterministic identity resolution.
- **Episodic memory** — timeline-bound, append-only, semantically searchable.
- **Resources** — POSIX-style virtual filesystem the agent navigates with `ls` / `read` / `grep` / `glob` / `edit`.
- **Context** — user-configured ambient context, auto-injected into the system prompt every turn.
- **Forms** — structured collection over a conversation: zod-authored definitions, lazily loaded, with colocated executors.

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
| `glove-memory/forms` | `defineForm` builder, `FormAdapter` contract, compiler, engine, projection |
| `glove-memory/tools` | Auto-registered read/write tool factories and `useMemory*` / `useEpisodic*` / `useResources*` / `useContext` / `useFormRunner` helpers |
| `glove-memory/in-memory` | Reference in-process adapters for dev/test |

## Architecture

Two roles, both implemented as Glove instances. The conversational **reader** answers user questions and pulls in memory when context demands it. The **curator** runs as an orchestrator-driven extractor with write access. Context attaches once on the conversational side and gives the agent both read and write tools because users naturally instruct the agent to update their own context ("remember that I prefer X").

### Recommended: don't attach memory tools to your main Glove

**If you're building an agent that needs memory access, we advise against attaching the entity / episodic / resources tools directly to your main Glove instance.** Build subagents — one per retrieval task — and register them on the main agent. Each subagent attaches **only the adapter slice it needs**; the main agent stays small and routes to the right subagent based on what the user asked for.

Why:

- **Bounded prompt surface.** The main agent's tool descriptions don't render every node class, every relationship, every episode kind, and every resource root on every turn. Each subagent renders only the schema slice for its role. Token cost scales with role, not with total ontology size.
- **Sharper routing.** Subagent names and descriptions are themselves part of the model's reasoning surface. "When the user asks about a person, route to `lookup`" is a tighter signal than "you have these eight memory tools, decide which to call."
- **Mutation scope is explicit.** A retrieval subagent attached with `useMemoryReader` *cannot* write — the affordance isn't there. The main agent never has to be told "don't accidentally create entities mid-conversation"; it structurally can't. For anything finer than the reader / curator line — one folder readable but not writable, a curator that files but never deletes — see [Narrowing what the agent may do](#narrowing-what-the-agent-may-do).
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
| `glove_episodic_search` | Content search over episodes — embedding-based semantic or in-process fuzzy/lexical, depending on the adapter *(only registered when adapter advertises `supportsSemanticSearch`)* |
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

### Forms

| Tool | Purpose |
|------|---------|
| `glove_form_list` | Registered forms, name + description — no module load |
| `glove_form_start` | Begin an instance, with optional seed values |
| `glove_form_status` | The open step in full *(tier 1)* |
| `glove_form_inspect` | Any step, field, or the whole outline *(tier 2)* |
| `glove_form_fill` | Patch of many fields at once; returns re-evaluated state |
| `glove_form_revise` | Amend an earlier answer |
| `glove_form_abandon` | Close out with a reason |
| `glove_form_history` | Read past fills *(reader registration)* |

## Narrowing what the agent may do

Two independent knobs, meant to be used together. One removes the *affordance* — the tool never reaches the model. The other removes the *capability* — the adapter refuses the call however it arrives.

### Tool allowlists — `options.tools`

Every `use*` helper takes an optional third argument selecting which tools of the surface get folded:

```ts
// A curator that files notes but can never delete or relocate anything.
useResourcesCurator(glove, resources, { tools: { deny: ["remove", "move"] } });

// An entity curator that may create and connect, but never merge.
useMemoryCurator(glove, entity, { tools: { deny: ["merge_nodes"] } });

// Context the agent adds to and revises, but can't clear.
useContext(glove, context, { tools: { deny: ["unset"] } });

// Or start from nothing and name what's allowed.
useResourcesCurator(glove, resources, {
  tools: { allow: ["ls", "read", "grep", "glob", "write"] },
});
```

Names may be full (`"glove_resources_remove"`) or short (`"remove"`). `allow` narrows first, then `deny` subtracts. **A selector that matches nothing throws `MemoryToolSelectionError`** — a typo in a `deny` entry would otherwise leave the tool registered, which is exactly what a denylist exists to prevent.

`useFormRunner` takes the same thing on its config (`tools: { deny: ["abandon"] }`), and `selectTools` is exported for filtering a surface you build yourself.

This is a *prompt-surface* control, not a data boundary: the adapter is still fully capable, and anything else holding it can still write. When the restriction has to hold structurally, reach for the next one.

### Path-scoped access policies — `withResourceAccess`

Wraps a `ResourceFsAdapter` so every call is checked against a policy keyed on path. A read-only research corpus, an off-limits subtree, an allowlist of the few places the agent may write:

```ts
import { withResourceAccess, useResourcesCurator } from "glove-memory";

const resources = withResourceAccess(new InMemoryResourcesAdapter({ schema }), {
  default: "none",
  rules: [
    { path: "/research", access: "read", note: "curated by the research team" },
    { path: "/research/scratch", access: "write" },
    { path: "/notes", access: "write" },
    { path: "/**/*.locked.md", access: "read" },
  ],
});

useResourcesCurator(glove, resources);
```

| Mode | Effect |
|------|--------|
| `"write"` | Readable and mutable. The default when no policy says otherwise. |
| `"read"` | Readable, but `write` / `edit` / `mkdir` / `move` / `remove` / `set_metadata` are refused with `ResourceAccessError` (`code: "access_denied"`). |
| `"none"` | Invisible. Reads are refused, and the path is filtered out of `ls`, `grep`, `glob`, `search`, and `links_for` results. |

- `path` is an absolute directory prefix (`/research` — the directory and everything under it) or a glob using the same `*` / `**` / `?` vocabulary as `glove_resources_glob`.
- Rules are evaluated in order and **the last match wins** — the `.gitignore` cascade. Write the broad rule first and the exception after it.
- `default` (`"write"` unless set) covers anything no rule matches. Set it to `"none"` for an allowlist-shaped policy.

Enforcement lives on the adapter, not the tool surface, for the same reason the reader / curator split does: it's structural. Whichever tools you fold, and whatever the model asks for, a write into a `"read"` path is refused.

Details worth knowing:

- **Multi-path reads filter rather than fail.** `ls`, `grep`, `glob`, `searchSemantic`, and `linksFor` drop hidden paths from their results, so a policy narrows what the agent sees instead of breaking navigation. Naming a hidden path *explicitly* (`read`, `stat`, or a `path`-scoped grep) is still refused — `exists` returns `false` rather than throwing, so it can't be used to probe.
- **Directories on the way to a grant stay listable.** With `{ default: "none", rules: [{ path: "/research/deep", access: "read" }] }`, `/research` shows up in `ls /` even though it isn't readable itself — otherwise the grant would be unreachable. Traversal is not read access; the files directly under it stay refused.
- **Blast radius is checked.** A recursive `remove` (or a directory `move`) is refused when it would reach *any* path the policy protects, so `rm -r /` can't take a read-only subtree with it. The check is conservative: a non-write rule whose territory merely intersects the subtree fails it.
- **The policy is in the tool descriptions.** Every resource tool appends a plain-language summary, so the model is told about the walls instead of discovering them one refused call at a time. Opt out with `describe: false` — that suppresses the text, never the enforcement.
- **`replaceLinkTarget` is refused under any restrictive policy.** It rewrites the whole tree and can't be scoped path-by-path. It's an orchestrator primitive with no tool exposing it — run reconciliation against the unwrapped adapter.
- **The embedding lifecycle passes through unfiltered.** `findFilesNeedingEmbedding` / `setEmbedding` run out-of-band on the host's behalf, not the agent's, and a read-only directory still needs its index maintained.

`getResourceAccessControl(adapter)` returns the compiled policy (or `undefined` for an unwrapped adapter); `ResourceAccessControl` is exported directly if you want to resolve modes yourself.

## System-prompt injection (context)

`useContext` wraps `Glove.processRequest`. On every turn it calls `adapter.render()` to materialise pinned entries as a markdown block, then composes `<base systemPrompt>` + `\n\n` + `<rendered context>` and calls `setSystemPrompt`. Pinned context goes **after** the developer's system prompt — developer prompt sets agent character and guardrails; user context modifies engagement for this specific user. Re-rendering happens every turn, so external updates the user made between turns are reflected immediately.

## Embedding lifecycle

Episodic and resources adapters generate embeddings out-of-band. Writes mark records `embeddingStatus: "missing"` (initial) or `"stale"` (content change) and return immediately. A separate process — typically a [Station](https://station.dterminal.net) signal — picks them up via `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding`, calls the configured `EmbeddingAdapter`, and writes vectors back via `setEmbedding`.

The `EmbeddingAdapter` contract is intentionally tiny — consumers plug in whatever provider they want without the package taking on a model dependency. The same `embeddingStatus` / `findEpisodesNeedingEmbedding` / `setEmbedding` lifecycle doubles as a **generic background-indexing seam** for any search backend, not just embeddings — see [Custom adapter with a background-built index](#custom-adapter-with-a-background-built-index-byo-search) below.

### Content search without embeddings (fuzzy mode)

Embeddings are **opt-in, not required**. Episodic memory works with no embedder at all — `glove_episodic_find` (kind / participant / time / property filters) and `glove_episodic_timeline` need nothing. Only `glove_episodic_search` (free-text content search) needs a ranking backend, and that backend doesn't have to be vectors.

Pass `fuzzySearch: true` (and no `embedder`) to `InMemoryEpisodicAdapter` for in-process lexical search over episode content — exact-phrase and substring hits plus a bigram-Dice fuzzy fallback that tolerates typos. It sets `supportsSemanticSearch: true` (so `glove_episodic_search` is registered), and needs zero external services, no vectors, and no out-of-band embed loop.

```ts
// No embeddings, no external service — content search still works.
const episodic = new InMemoryEpisodicAdapter({ schema, fuzzySearch: true });
```

`embedder` wins when both are supplied (vector search takes precedence, and `fuzzySearch` is ignored). With neither, `supportsSemanticSearch` is `false` and the search tool is simply not registered — `find` + `timeline` remain fully available. `searchEpisodes` is backend-agnostic: the `supportsSemanticSearch` flag advertises that content search is callable, not how it ranks, so a BYO adapter can offer fuzzy, embedding, or hybrid search behind the same contract.

### Custom adapter with a background-built index (BYO search)

For production, implement your own `EpisodicMemoryAdapter` over your store and search backend. The `embeddingStatus` + `findEpisodesNeedingEmbedding` + `setEmbedding` methods are a **generic background-indexing lifecycle**, not embedding-specific — the index can be a vector store, SQLite FTS5, Postgres `tsvector`, a BM25 inverted index, Meilisearch, Tantivy, whatever. To back `glove_episodic_search` with it: set `supportsSemanticSearch: true` and implement `searchEpisodes`. The method groups play distinct roles:

- **Writes** (`recordEpisode` / `updateEpisode` / `deleteEpisode`) — persist to your primary store, mark the row `missing` (new) or `stale` (content changed), and return immediately. No indexing on the hot path.
- **Structured reads** (`findEpisodes` / `episodesForEntity` / `episodesBetween`) — query the primary store directly. Always current; they don't depend on the index.
- **Index lifecycle** (`findEpisodesNeedingEmbedding` / `setEmbedding`) — your background worker's queue and commit. `findEpisodesNeedingEmbedding({ limit })` returns the dirty rows; the worker builds the index artifact and calls `setEmbedding(id, vector)` to commit it and flip the row to `fresh`.
- **`searchEpisodes(query, opts)`** — what the tool calls. Query your index, apply `opts.filter`, return `EpisodeSearchResult[]` (`{ episode, score, distance }`) highest `score` first.

```ts
// Background worker — a Station signal, cron, or queue consumer. Index type is your choice.
async function reindexPass() {
  const pending = await adapter.findEpisodesNeedingEmbedding({ limit: 100 });
  if (!pending.length) return;
  const artifacts = await buildIndexArtifacts(pending.map((p) => p.content)); // vectors, FTS docs, BM25 postings…
  for (let i = 0; i < pending.length; i++) {
    await adapter.setEmbedding(pending[i].id, artifacts[i]); // commit to the index + mark fresh
  }
}
```

Rules to match the reference adapter's behavior:

- **`supportsSemanticSearch: true` is the switch** — without it `useEpisodicReader` never folds `glove_episodic_search` and your `searchEpisodes` is dead code.
- **Eventual consistency is inherent** — a just-recorded episode is visible to `find` / `timeline` immediately but to `search` only after the worker catches up.
- **`searchEpisodes` must honor `opts.filter`** (`kind`, `participantIds`, `timeRange`), return `{ episode, score, distance }` sorted by `score` descending, and strip `provenance` from returned episodes (reader tools expect that).
- **Normalize relevance to [0, 1]** before blending with recency (`score = (1 - recencyWeight) * relevance + recencyWeight * recencyScore`, default `recencyWeight = 0.2`, 30-day half-life), or `recencyWeight` won't behave like the reference adapter — BM25 scores are unbounded, so divide by the top hit or squash.
- **Re-flag on content change only** — participant / property / occurredAt patches don't change the searchable text, so don't reindex them (mirror `updateEpisode` in the in-memory adapter).
- **`setEmbedding`'s `vector` param is only meaningful for a vector index.** For FTS / BM25 / an external search service, ignore it and treat `setEmbedding` as "write my doc + mark fresh". It's non-optional on the interface, so you still implement it.

### Implementation choices in the in-memory adapters

- **Stale marking is content-only on episodes.** `updateEpisode` flips `embeddingStatus: "stale"` and drops the cached vector only when the `content` field changes — kind / participant / property / occurredAt patches don't re-embed. The embedding represents `content`; the spec is silent on the others. Consumers wanting different behavior can delete + re-record.
- **Recency blend uses a 30-day half-life.** `searchEpisodes` ranks by `(1 - recencyWeight) * semanticScore + recencyWeight * recencyScore` where `recencyScore = exp(-ln(2) * ageMs / halfLifeMs)`, `halfLifeMs = 30 days`. Default `recencyWeight = 0.2`. Companion adapters (sqlite/postgres) may pick different curves; only the shape of the blend is fixed by the spec.

## Forms

Structured collection over a conversation. Definitions are **code** — zod schemas, gate closures and executors, colocated in one builder chain — and the agent never reads them. It reads a projection of evaluated state.

```ts
import { z } from "zod";
import { defineForm } from "glove-memory/forms";

export const piIntake = defineForm({
  id: "pi-intake",
  version: 3,
  name: "Personal injury intake",
  description: "Collects claimant, incident, and injury details for a new PI matter.",
  conduct: "Conversational, one or two questions at a time. Don't read the field list aloud.",
})
  .step("identity", { title: "Claimant", preview: "name, contact details" }, (s) =>
    s
      .field("fullName", {
        schema: z.string().min(2),
        label: "Full name",
        ask: "Get their full legal name as it would appear on a filing.",
      })
      .field("email", { schema: z.string().email(), label: "Email" })
      .field("phone", { schema: z.string().optional(), label: "Phone" }),
  )
  .step(
    "incident",
    { title: "Incident", preview: "date, type, what happened", when: (v, s) => s.stepComplete("identity") },
    (s) =>
      s
        .field("incidentType", {
          schema: z.enum(["vehicle", "premises", "medical"]),
          label: "Type of incident",
        })
        .field("vehicleCount", {
          schema: z.number().int().min(1).optional(),
          label: "Vehicles involved",
          when: (v) => v.incidentType === "vehicle",
        }),
  )
  .checkpoint("conflict-check", {
    when: (v) => Boolean(v.fullName && v.email),
    blocking: true,
    waitMessage: "Running a conflicts check — one moment.",
    async run(ctx) {
      const hit = await conflicts.check(ctx.values.fullName, ctx.values.email);
      if (hit) return { fail: `Conflict with matter ${hit.matterId}.` };
    },
  })
  .onComplete(async (ctx) => {
    await ctx.memory.upsertNode("Person", { name: ctx.values.fullName, email: ctx.values.email });
  })
  .build();
```

`ctx.values` is fully typed at every callsite — each `.field()` widens the accumulated values type, so `ctx.values.incidentType` narrows to the enum union and `ctx.values.phone` is `string | undefined`.

### Optionality comes from zod, not a flag

`required` is not a field option. A field is optional iff its schema accepts `undefined`. One source of truth, so the inferred values type and the runtime gate can never disagree. `type` is derived too — `z.toJSONSchema` plus a small renderer turns the schema into the short human string the agent reads (`"email address"`, `"one of: vehicle | premises"`, `"integer >= 1"`). There is no field-type vocabulary to extend.

### Writes are never gated

**There is no lock.** Any value the agent can derive, at any point in the conversation, is accepted — the only thing that can reject a write is zod. A user who answers question six while being asked question two has answered question six. `glove_form_fill` takes a patch of *any* field ids, validates each independently, and returns what landed.

Field ids are forgiving: `full_name`, `Full name` and `fullName` all resolve to the same field, via an alias index built at compile time over normalised ids and labels. A definition whose fields would collide once case and punctuation are stripped is rejected at compile, so resolution is never a guess. An id that still doesn't resolve comes back with `did_you_mean` rather than a bare rejection — models guess ids confidently for fields they haven't seen, and a bare miss costs a whole round trip.

Sequence is advisory, and splits into two unrelated things:

- **`when` — applicability.** Whether a field *means anything* given current answers. `vehicleCount` is meaningless on a slip-and-fall. Inapplicable fields don't count toward completion and aren't asked about — but a value supplied for one is kept.
- **Steps — ask order.** A conversational grouping and a checkpoint boundary. `ask: true` means "steer toward this now"; the agent stays free to follow the user elsewhere and come back.

### Entries, liveness, and held values

`entries` maps each field to an append-only log of revisions plus a cursor naming the one in force. Nothing is ever removed or rewritten — a correction appends, it does not overwrite — so any earlier answer stays readable and any change stays reversible. A retraction is a revision too, which is what makes `retract`, `undo` and `redo` pure cursor moves:

```ts
await runner.retract("ticketReference");   // withdraw, keeping the answer
await runner.undo();                       // take back the last answer anywhere
await runner.undo("mileage");              // or on one field
await runner.redo("mileage");
await runner.history("mileage");           // every answer ever given
```

The agent reaches all four through `glove_form_revise`'s `action` parameter — `set`, `retract`, `undo`, `redo` — rather than four separate verbs, because tool schemas are re-sent on every model call and measured out at roughly three quarters of the surface's context cost.

On top of that log, what changes is which entries are **live**:

| | |
|---|---|
| entry | an answer the user gave for a field |
| applicable | `field.when(liveValues, state) === true` |
| live entry | an entry whose field is applicable |
| `values` | derived: live entries — what counts |
| `held` | derived: non-live entries — kept, doesn't count |

**Held** means *the user told us this, and it isn't relevant right now.* Either it was answered before it applied ("there were two cars" landing before `incidentType`), or a revision orphaned it (`vehicle` → `premises`). Change the answer back and the entry is live again, with the original value intact.

Repartitioning — the recomputation of the live set — runs on every commit and is not a data move: assume every entry is live, evaluate each `when`, drop the entries whose gate returned false, repeat until the set stops shrinking. Shrink-only, so it always terminates and the common case is one pass.

Completion counts applicable required fields only. A form with a held `vehicleCount` on a premises claim is complete without it, and `form.onComplete` receives `values`, never `held`.

### Executors

Four colocation points, one signature:

| Hook | Fires |
|---|---|
| `field.onFill` | that field's entry crosses into the live set |
| `step.onComplete` | every applicable required field in the step is valid |
| `checkpoint.run` | the checkpoint's `when` first holds |
| `form.onComplete` | every applicable required field is valid |

Dispatch is commit-then-run: values and the rising-edge log commit in one atomic write, then executors run. At-least-once with a per-occurrence `idempotencyKey` (`${instanceId}:${hookId}:${occurrence}`) — a retry reuses the key, a genuine second crossing gets a fresh one, and whether a repeat is real work is the executor's call. An executor can hand back `{ patch }` (derived values, committed like any other write), `{ fail }` (a blocking checkpoint rejecting — recorded and surfaced to the agent), `{ jump }`, or `{ complete: true }`.

`ctx.memory` bridges to the other four subsystems (`upsertNode`, `connect`, `recordEpisode`, `writeResource`, `setContext`) with provenance supplied by the engine.

### Triggers that steer the conversation

A checkpoint *is* a trigger: a condition over values, fired on its rising edge,
running an executor. Returning `{ jump }` moves the open step — forward to skip
ahead, or **back to a step that already finished**:

```ts
.checkpoint("verify-identity", {
  when: (v) => v.claimValue > 10_000,
  run: () => [
    { patch: { verificationRequired: true } },
    { jump: "claimant" },          // go back and re-check who we're talking to
  ],
})
```

An executor may return one effect or an array of them, so a router can stamp a
derived value *and* move in the same firing.

A jump backwards is a **revisit**: the step's answers stay filled but come back
with `ask: true`, because there is no point being sent somewhere every field
reads as settled. Tier 0 says so too —
`[form: x] back at step 1/3 "Claimant" — go through it again` — and it says it
even when the form had already completed, since a silent jump is the same as no
jump at all.

A router branches on **both** halves of the state. `when` and `run` each get a
`FormState` — step completion, which checkpoints have already fired, whether the
form is done — alongside the typed values, so a trigger can route on where the
conversation has been and not only on what it holds:

```ts
.checkpoint("route", {
  when: (v, s) => Boolean(v.kind) && s.stepComplete("triage"),
  run: (ctx) => ({
    jump: ctx.state.stepComplete("triage") && ctx.values.kind === "complex"
      ? "complex-detail"
      : "simple-detail",
  }),
})
```

`checkpointFired` reads the same counters the gate saw, so asking about a
checkpoint inside its own `run` reports whether it fired *before* — not the
firing in progress.

**Terminating collection.** `{ terminate: reason }` stops the form outright, for
the cases where carrying on would be wrong rather than merely unfinished —
ineligible, duplicate, withdrawn:

```ts
.checkpoint("eligibility", {
  when: (v) => typeof v.age === "number" && v.age < 18,
  run: () => ({ terminate: "Under 18 — not eligible for this scheme." }),
})
```

It is neither of the two effects that already existed: `fail` records a
rejection and lets the conversation carry on, and `complete` claims the form
succeeded. `terminate` closes the instance with the reason on `closedReason`,
stops every field asking, refuses further writes, and takes the form out of tier
0. It beats a completion that would otherwise have landed on the same commit —
an ineligible claim must not read as a finished one.

A jump is a nudge, not a pin. The override is released by the next write that
lands in the step it sent you to, after which ordering goes back to being
derived. A jump naming a step that doesn't exist is ignored.

### Lazy loading

Modelled on the inbox: a cheap standing notification, detail pulled on demand.

**Tier 0** — one line appended to the system prompt each turn, the way `useContext` injects:

```
[form: pi-intake] step 2/4 "Incident" · pending: incidentDate, incidentType, description
later: Injury (treatment sought, providers) · Representation (prior counsel, fee basis)
```

Pending *labels* rather than a count, because "5 fields pending" would force a tool call every turn just to learn what to ask. One-line `preview` per remaining step, because that is what makes opportunistic capture work without loading the whole form — an agent that hears "I already have a lawyer" during step 2 can see representation is coming. Asks, hints, enum options, validation rules and every field outside the open step stay out.

**Tier 1** (`glove_form_status`) — the open step in full. **Tier 2** (`glove_form_inspect`) — any named step, a single field, or the whole outline, with gated-off fields marked `ask: false` so the agent can answer "what else will you need?" without promising something a branch may skip.

**Registry-level laziness** — form modules aren't imported until started:

```ts
const registry = new FormRegistry().register("pi-intake", {
  name: "Personal injury intake",
  description: "New PI matter — claimant, incident, injury.",
  load: () => import("./forms/pi-intake").then((m) => m.piIntake),
});
```

`glove_form_list` renders name + description from the registration — no module load, no compile. `compileForm` runs on first `start`, then caches.

### Wiring

```ts
const { runner } = useFormRunner(glove, formAdapter, {
  registry,
  subject: conversationId,
  memory: { entity, episodic, resources, context },
});

useFormReader(otherGlove, formAdapter, { registry }); // read past fills, no writes
```

`useFormRunner` folds the tools and wraps `processRequest` for tier-0 injection, then hands back the runner so hosts can start instances and resolve checkpoints without going through the model.

### Operational notes

Verified by probe, and worth knowing before you wire this to anything real:

- **Hook order within one commit is fixed**: `field.onFill` → `step.onComplete` → `checkpoint.run` → `form.onComplete`.
- **Only rising edges fire.** A step that becomes incomplete fires nothing; completing again is a fresh occurrence with a new idempotency key.
- **A step with no applicable required fields is complete** — including an all-optional step, whose `onComplete` therefore fires the moment the form starts.
- **A throwing executor does not roll back the write.** Dispatch is commit-then-run, so the answer is durable; the failure is recorded and surfaced to the agent.
- **A recorded failure is not retried.** At-least-once covers a crash *before* the outcome was recorded — a hook that ran and failed stays failed until its field crosses into live again. If you need retries, do them inside the executor.
- **A blocking checkpoint whose executor never returns leaves the instance `awaiting` indefinitely.** Writes are refused with `form_blocked` until `resolveCheckpoint` is called. There is no timeout; a host that can crash mid-checkpoint should recover them on startup.
- **`recordDispatch` writes outside the CAS envelope.** A concurrent commit can lose dispatch bookkeeping, which costs a duplicate executor run — the exact thing the idempotency key exists to absorb.
- **A complete instance stays reachable.** Finishing a form doesn't end the conversation about it, so `revise` / `retract` / `undo` still resolve against it; only `abandon` closes it. Tier 0 stays quiet once complete.

### Writing a form adapter

`FormAdapter` is a storage-and-retrieval contract and nothing more. The engine
holds every semantic — liveness, applicability, rising edges, completion — and
recomputes them from whatever you hand back, so an adapter that persists
`FormInstance` faithfully is a correct adapter whatever it's built on.

Four invariants, and they are the whole of it:

1. **`entries` appends, never replaces.** `commitInstance` receives a
   `FormEntryCommit` per field (`{ append?, cursor? }`), not a `FieldHistory`.
   Append to the existing log, then move the cursor, then clamp it.
   Overwriting a field's log destroys answers the design guarantees are kept —
   `applyEntryCommit` is exported from `glove-memory/forms` so you can reuse
   the exact semantics rather than re-derive them.
2. **`version` is compare-and-set.** Reject a stale `ifVersion` with
   `FormConflictError`; bump `version` on every write that lands. The runner
   retries a conflict — it relies on losing, not on winning.
3. **A commit is all-or-nothing.** Entries, occurrence counters, dispatch log
   and status land together or not at all. That's what makes commit-then-run
   dispatch safe.
4. **Reads hand back snapshots.** Clone if your store could return a live
   reference.

Everything else is yours: storage engine and schema, indexing, retention,
*how* you achieve atomicity, how much provenance you keep, multi-tenancy,
encryption, soft deletes. The contract deliberately doesn't model any of it.

The per-method contract lives in doc comments on
[`FormAdapter`](./src/forms/adapter.ts) — what each method must set, which
error to throw when, and which fields replace versus merge. `InMemoryFormAdapter`
is the reference implementation and is short enough to read end to end before
writing your own.

### Def drift

Instances pin `defVersion` at start. When it stops matching the registered def the runner does not guess: default is `status: "stale"` with the reason surfaced, and a def may supply `migrate(old, fromVersion)` to carry values forward. Bumping `version` is the developer's signal that a change is breaking — additive changes don't need it.

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
- Runtime-authored forms. Definitions are code — there is no JSON compile target, no authoring UI, and no second front end.
- Compensating a re-fired form executor. Hooks fire on every rising edge with a per-occurrence idempotency key; whether a repeat is real work is the executor's decision.
- Binary resources. Resources is text-only.
- `.` and `..` path resolution. All paths are absolute.
