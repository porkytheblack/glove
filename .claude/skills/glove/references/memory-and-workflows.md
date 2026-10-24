# Memory, forms, goals and facts

> Read when the agent must remember people, events or files (glove-memory), collect structured answers over a conversation (forms), pursue objectives across interruptions (goals), or reuse details people already mentioned (glove-facts and preparation).
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Choosing how to collect information

Read [workflows.md](memory-and-workflows.md#goals-facts-and-form-preparation) when adding dynamic goals, recording reusable evidence, or preparing forms from existing facts. Goals ship in `glove-memory/goals`; shared evidence ships in `glove-facts`. The reference covers public imports, tool mounting, lifecycle/recovery rules, and preparation through a supplied Glove agent with tracing preserved. Supplying that agent enables preparation.

Pick the smallest tool for collecting information (guide: https://glove.dterminal.net/docs/goal-oriented-agents):

- A plain folded tool when the model can supply every argument now.
- Memory context (`useContext`) for standing information every turn should see.
- Facts (`useFacts` → `record_fact`) for details people mention early or that several workflows reuse. Recorded facts are unverified; they never complete a goal or fill a field on their own.
- Forms (`useFormRunner`) for a specific set of validated answers, possibly over several steps or followed by an action.
- A display-stack UI form (`pushAndWait`) for exact input or a final Confirm that should not pass through the model (not available in voice).
- Goals (`useGoalRunner`) for obligations across the conversation, with versioned progress and deferrals.

Forms do not settle goals: call `goals.update` from a step or checkpoint executor. Every hook that rises in one commit runs (field, skip, step, checkpoint, form), and a checkpoint's `fail`/`terminate` does not stop a `form.onComplete` in the same commit, so put an irreversible action in the executor that obtained the confirmation. Preparation needs a dedicated agent, separate from the workflow agent.

## Memory (`glove-memory`)

Schema-first memory layer with five sibling subsystems. Storage-agnostic adapter contracts; reference in-memory adapters ship for dev/test. Status: draft v0.1; companion storage backends (`glove-memory-sqlite`, `glove-memory-postgres`) are not yet released.

### The five subsystems

| Subsystem | Adapter | What it's for |
|-----------|---------|---------------|
| Entity | `EntityMemoryAdapter` | Graph-shaped, schema-first, deterministic identity resolution. Nodes (people, organizations, projects) and typed edges between them. Curator-written, agent-read. |
| Episodic | `EpisodicMemoryAdapter` | Timeline-bound, append-only events. Meetings, decisions, observations. Time is a first-class field; semantic search is opt-in (advertised by `supportsSemanticSearch`). |
| Resources | `ResourceFsAdapter` | POSIX-style virtual filesystem the agent navigates with `ls` / `read` / `grep` / `glob` / `edit`. Holds research notes, transcripts, link collections. Text-only; absolute paths only (no `.` / `..`). |
| Context | `ContextAdapter` | User-configured ambient context, appended as transient runtime context before each model iteration. Different shape: not curator-extracted, no reader/curator split — one registration gives the agent both read and write tools. |
| Forms | `FormAdapter` | Structured collection over a conversation. Definitions are code (Zod + closures), loaded a tier at a time so a 60-field form costs the same standing prompt line as a 6-field one. |

### Architectural recommendation: don't dump memory tools on the main Glove

If you're building an agent that needs memory access, **do not attach the entity / episodic / resources tools directly to your main Glove**. Build subagents — one per retrieval task — and register them on the main agent. Each subagent attaches only the adapter slice it needs.

Why:

- **Bounded prompt surface.** Tool descriptions render the schema slice for that role only — token cost scales with role, not with total ontology size.
- **Sharper routing.** `lookup` / `recall` / `find-notes` subagent names are themselves a reasoning surface. Tighter signal than "you have eight memory tools, decide which".
- **Mutation scope is structural.** A subagent attached with `useMemoryReader` *cannot* write; the affordance isn't there. Finer than that — one folder readable but not writable, a curator that files but never deletes — is `{ tools: { allow, deny } }` plus `withResourceAccess`.
- **Adapters stay shared.** All subagents read and write to the same underlying graph / timeline / filesystem. Splitting tools does not split the data.

Same advice on the curator side: a parent curator that routes to specialised write-side subagents (entity-linker, episode-recorder, resource-filer) beats a single curator with every write tool attached.

The exception is `useContext`. Context is small (4 tools), user-driven ("remember that…"), and ships with the runtime-context provider that has to live on the agent the user actually talks to. **Keep `useContext` on the main agent.**

See [examples.md — Memory: subagent-delegated reader / curator composition / context flow](examples.md) for worked-out patterns.

### Helper families

Each helper folds the relevant tool surface onto a Glove. All return the same `G` for chaining; all operate on either an `IGloveBuilder` or an `IGloveRunnable` (anything that exposes `fold`).

| Helper | Folds | Notes |
|--------|-------|-------|
| `useMemoryReader(glove, adapter)` | `glove_memory_find`, `_get`, `_query` | Read-only entity graph access. |
| `useMemoryCurator(glove, adapter)` | reader tools + `_add_node`, `_update_node`, `_connect`, `_disconnect`, `_merge_nodes` | Full entity write access. |
| `useEpisodicReader(glove, adapter)` | `glove_episodic_find`, `_timeline`, `_search` | `_search` only registered when `adapter.supportsSemanticSearch === true`. |
| `useEpisodicCurator(glove, adapter)` | reader tools + `_record`, `_update`, `_delete` | |
| `useResourcesReader(glove, adapter)` | `glove_resources_ls`, `_read`, `_stat`, `_grep`, `_glob`, `_search`, `_links_for` | `_search` only when `supportsSemanticSearch`. |
| `useResourcesCurator(glove, adapter)` | reader tools + `_write`, `_edit`, `_mkdir`, `_move`, `_remove`, `_set_metadata` | |
| `useContext(glove, adapter)` | `glove_context_get`, `_set`, `_update`, `_unset` | Calls `adapter.render()` before each model iteration and appends a transient user-role snapshot at the input tail; system prompt and saved history stay unchanged. |

Every helper takes an optional trailing `{ tools?: { allow?, deny? } }` (on `useFormRunner`, a field on its config) narrowing which tools actually get folded — see below.

### Layered memory — shared and private strata in one view

Memory arrives in strata: some shared and authored elsewhere (an org handbook, a common ontology, published events, standing instructions) that the agent reads but must never change, some its own. They live in **different stores** — a shared corpus can't be copied into every private one — and the agent shouldn't have to know that. Each `layer*` function takes a stack and returns one adapter of the ordinary contract, so the existing `use*` helpers fold the ordinary tool surface over it.

```ts
const resources = layerResources([
  { name: "handbook", adapter: sharedFs,  access: "read", paths: ["/handbook"] },
  { name: "notes",    adapter: privateFs, access: "write" },
]);
useResourcesCurator(glove, resources);
```

All four subsystems layer: `layerEntity`, `layerEpisodic`, `layerResources`, `layerContext` (from `glove-memory/layered`). Rules that hold everywhere: **exactly one** `access: "write"` stratum per stack (zero makes every write tool a trap, two makes routing ambiguous — both throw at construction); reads merge in layer order (earlier wins a collision, so order IS the shadowing rule); writes route to whichever stratum owns the target and are refused with `MemoryLayerError` (`code: "layer_read_only"`, naming the layer); `limit`/`offset` apply to the merged result (each stratum is asked for `limit + offset` with no offset, because the rows an earlier layer skipped aren't the rows the merged view skips); `setEmbedding` is allowed against read-only strata because indexing is the host's business, not the agent's; `layerOf(id|path)` tells the host which stratum something came from.

**Resources** — layer order is precedence and `paths` scopes a layer to a subtree, which covers both mounted (disjoint prefixes) and union (both span `/`, private listed first shadows shared) with one mechanism. Paths are NOT translated: a layer scoped to `/handbook` calls its adapter with that same absolute path, so the shared store must be authored under that prefix — translating would silently invalidate every stored `metadata.links` target. A stratum can't leak outside its prefix (results are filtered to what it claims), but directories on the way down to a claimed prefix stay listable so the mount is reachable. Writes route to whoever already HOLDS the path, falling back to the prefix owner for a new path — that ordering is what makes `remove("/handbook/pay.md")` report a read-only stratum instead of the "not found" you'd get from trying the private store first. No copy-on-write; a cross-stratum move and a recursive remove that would reach a shared stratum are both refused.

**Entity** — two things to know. `addNode` resolves identity against the read-only strata BEFORE writing (via the class's `identityKeys`) and returns the shared node's id with `created: false`, because otherwise every agent grows a private duplicate of every shared entity on first mention and the shared graph quietly forks; the consequence is that the returned id may be immutable, so a follow-up `updateNode` is refused. And **edges cannot straddle strata** — `connect` validates both endpoints inside one adapter and the private store has no row for a shared node, so a cross-stratum `connect` is refused with `code: "cross_layer_unsupported"`. The workaround is real: episodic `participants` and resource `metadata.links` are unvalidated plain ids, so they cross strata freely. This is the one genuinely lossy part of layering a graph.

**Episodic** interleaves strata into one true chronological timeline; `supportsSemanticSearch` is true when ANY stratum supports it and `searchEpisodes` queries only those that do (merged ranking is a best-effort interleave — two independently-built indexes don't produce comparable scores). **Context** merges reads and concatenates each stratum's `render` block shared-first; `setSection` replaces only the writable stratum's entries.

Layering composes with `withResourceAccess` rather than replacing it: layering answers *which store does this live in*, path policies answer *what may be done inside one store*. Wrap a layer's adapter to gate it further, or wrap the layered adapter to gate the merged view. All layers in a stack are expected to share one `MemorySchema`.

### Narrowing what the agent may do

Two independent knobs, meant to be used together. One removes the **affordance** — the tool never reaches the model. The other removes the **capability** — the adapter refuses the call however it arrives.

**Tool allowlists.** `useResourcesCurator(glove, resources, { tools: { deny: ["remove", "move"] } })` folds a curator that files notes but can never delete or relocate; `{ tools: { allow: ["ls", "read", "grep"] } }` starts from nothing and names what's permitted. Selectors resolve in full (`"glove_resources_remove"`) or short (`"remove"`); `allow` narrows first, `deny` subtracts. A selector matching nothing throws `MemoryToolSelectionError` — a typo in a `deny` entry would otherwise leave the tool registered. `selectTools` is exported for surfaces you build yourself. This is a prompt-surface control only; the adapter stays fully capable.

**Path-scoped access policies.** `withResourceAccess(adapter, policy)` wraps a `ResourceFsAdapter` so every call is checked by path:

```ts
const resources = withResourceAccess(new InMemoryResourcesAdapter({ schema }), {
  default: "none",
  rules: [
    { path: "/research", access: "read", note: "curated by the research team" },
    { path: "/notes", access: "write" },
    { path: "/**/*.locked.md", access: "read" },
  ],
});
useResourcesCurator(glove, resources);
```

`"write"` is readable and mutable; `"read"` refuses every mutation with `ResourceAccessError` (`code: "access_denied"`); `"none"` refuses reads and is filtered out of `ls` / `grep` / `glob` / `search` / `links_for` results. `path` is an absolute directory prefix or a glob (`*` / `**` / `?`, same vocabulary as `glove_resources_glob`); rules cascade **last-match-wins** over `default` (`"write"` unless set). Enforcement is on the adapter, not the tool list, so a write into a read-only folder is refused whichever tool asks — and the two knobs compose.

Details that bite if you don't know them: multi-path reads *filter* rather than fail (naming a hidden path explicitly is still refused; `exists` returns `false` rather than throwing); directories on the way to a granted subtree stay listable, so an allowlist policy is navigable, but traversal is not read access; a recursive `remove` or a directory `move` is refused when it would reach any protected path; the policy is rendered into every resource tool description (`describe: false` suppresses the text, never the enforcement); `replaceLinkTarget` is refused under any restrictive policy (run reconciliation unwrapped); and `findFilesNeedingEmbedding` / `setEmbedding` pass through unfiltered because the embedding loop is the host's, not the agent's.

### Tool inventory

#### Entity (`useMemoryReader` / `useMemoryCurator`)

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

#### Episodic (`useEpisodicReader` / `useEpisodicCurator`)

| Tool | Purpose |
|------|---------|
| `glove_episodic_search` | Content search over episodes — embedding-based semantic or in-process fuzzy/lexical, depending on the adapter *(only when `supportsSemanticSearch`)* |
| `glove_episodic_find` | Structured filter — by kind, participant, time range, properties |
| `glove_episodic_timeline` | Chronological listing for an entity or time window |
| `glove_episodic_record` | Append a new episode *(curator)* |
| `glove_episodic_update` | Patch an existing episode *(curator)* |
| `glove_episodic_delete` | Remove an episode *(curator)* |

#### Resources (`useResourcesReader` / `useResourcesCurator`)

| Tool | Purpose |
|------|---------|
| `glove_resources_ls` | List directory contents |
| `glove_resources_read` | Read a file body, with optional line range |
| `glove_resources_stat` | Get metadata about a single path |
| `glove_resources_grep` | Text/regex search across the tree |
| `glove_resources_glob` | Find paths by name pattern |
| `glove_resources_search` | Semantic search *(only when `supportsSemanticSearch`)* |
| `glove_resources_links_for` | Reverse-lookup: find resources linking to a target |
| `glove_resources_write` | Create or overwrite a file *(curator)* |
| `glove_resources_edit` | Replace a unique substring *(curator)* |
| `glove_resources_mkdir` | Create an empty directory *(curator)* |
| `glove_resources_move` | Rename or relocate *(curator)* |
| `glove_resources_remove` | Delete a file or directory *(curator)* |
| `glove_resources_set_metadata` | Patch metadata without rewriting body *(curator)* |

#### Context (`useContext`)

| Tool | Purpose |
|------|---------|
| `glove_context_get` | Read entries by section or list all |
| `glove_context_set` | Add a new entry |
| `glove_context_update` | Patch an existing entry in place |
| `glove_context_unset` | Remove an entry or wipe an entire section |

#### Forms (`useFormRunner` / `useFormReader`)

| Tool | Purpose |
|------|---------|
| `glove_form_list` | Registered forms, name + description — no module load |
| `glove_form_start` | Begin an instance, with optional seed values |
| `glove_form_status` | The open step in full *(tier 1)* |
| `glove_form_inspect` | Any step, single field, or whole outline *(tier 2)* |
| `glove_form_fill` | Patch of many field ids at once; returns re-evaluated state |
| `glove_form_revise` | `action`: `set` / `skip` / `retract` / `undo` / `redo` |
| `glove_form_abandon` | Close out with a reason |
| `glove_form_history` | Read past fills *(reader registration)* |

### `MemorySchema` — the shared ontology

One schema object is passed to every adapter. Lives in code; the package does not persist it, validate it across deployments, or expose migration primitives — that's the consumer's concern.

```ts
import { MemorySchema } from "glove-memory/core";
import { z } from "zod";

const schema = new MemorySchema()
  .defineNodeClass({
    name: "Person",
    schema: z.object({ name: z.string(), email: z.string().optional() }),
    identityKeys: [["email"], ["name"]],          // multi-set: any matching set folds the write
    searchableProperties: ["name", "email"],      // indexed for fuzzy / contains
  })
  .defineRelationship({
    type: "worksAt",
    from: "Person",
    to: "Organization",
    propertiesSchema: z.object({ since: z.string().optional() }).optional(),
    multi: false,                                  // default — re-connect updates rather than duplicating
  })
  .defineEpisodeKind({
    name: "meeting",
    description: "A scheduled gathering.",
    propertiesSchema: z.object({ duration_min: z.number() }).optional(),
  })
  .defineResourceRoot({
    path: "/research",
    description: "External research artifacts.",
    semanticSearch: true,                          // default true; false skips embedding lifecycle for this root
  });
```

What's safe at runtime:

- Adding a new node class, relationship, or episode kind is always safe.
- Adding an *optional* property is always safe.
- Adding a *required* property won't break reads; new writes that don't supply it fail validation.
- Removing or renaming properties needs a consumer-managed rewrite — the adapter won't notice.
- Changing identity keys may silently collapse or split nodes on subsequent writes.

### Provenance — required, append-only, every write

Every adapter write takes a `Provenance`. It's append-only per node, edge, episode, resource, and context entry. Reader-facing tools filter `provenance` out of results; only direct adapter calls return it.

```ts
interface Provenance {
  source: string;     // "conversation:<id>/turn:<n>", "manual", "import:<kind>:<id>"
  actor: string;      // "curator-run-xyz", "user:don", "system"
  timestamp: string;  // ISO 8601
  note?: string;      // free-form rationale (identity-merge decisions, conflict notes)
}
```

`Link` is the shared cross-reference vocabulary — episodes pointing at people, resources pointing at episodes, context entries pointing at projects.

```ts
interface Link {
  kind: "entity" | "episode" | "resource";
  id: string;             // entity / episode id, or resource path
  relation?: string;      // free-form, e.g. "primary-contact", "source-transcript"
}
```

The package does **not** validate that link targets exist — adapters stay decoupled. Cross-validation is the curator / orchestrator's job.

### Embedding lifecycle — out-of-band, BYO adapter

Episodic and resources use the same lifecycle. Writes mark records `embeddingStatus: "missing"` (initial) or `"stale"` (content change) and return immediately. A separate process — typically a [Station](https://station.dterminal.net) signal — does the embed pass:

```ts
interface EmbeddingAdapter {
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

The refresh loop:

```ts
const pending = await episodic.findEpisodesNeedingEmbedding({ limit: 50 });
const vectors = await embedder.embed(pending.map((p) => p.content));
for (let i = 0; i < pending.length; i++) {
  await episodic.setEmbedding(pending[i].id, vectors[i]);
}
```

Resources use `findFilesNeedingEmbedding` / `setEmbedding` (both optional on `ResourceFsAdapter`, present only when `supportsSemanticSearch === true`). Stale marking on episodes is **content-only** in the in-memory adapter — `kind` / `participants` / `properties` / `occurredAt` patches don't re-embed; consumers wanting different behaviour can delete + re-record. The recency blend in `searchEpisodes` defaults to `recencyWeight = 0.2` with a 30-day half-life.

### Custom episodic adapter with a background index (BYO search)

The `embeddingStatus` + `findEpisodesNeedingEmbedding` + `setEmbedding` lifecycle is a **generic background-indexing seam**, not embedding-specific — the index can be vectors, SQLite FTS5, Postgres `tsvector`, BM25, Meilisearch, Tantivy, etc. To back `glove_episodic_search` with a custom index, implement `EpisodicMemoryAdapter` with `supportsSemanticSearch: true` and a `searchEpisodes` method. The method groups play distinct roles:

- **Writes** (`recordEpisode` / `updateEpisode` / `deleteEpisode`) persist to the primary store, mark the row `missing` (new) / `stale` (content changed), and return fast — no indexing on the hot path.
- **Structured reads** (`findEpisodes` / `episodesForEntity` / `episodesBetween`) hit the primary store directly and are always current — they don't touch the index.
- **Index lifecycle** (`findEpisodesNeedingEmbedding` → build artifact → `setEmbedding`) is the background worker's queue + commit. `setEmbedding(id, vector)` commits the index artifact and flips the row to `fresh`.
- **`searchEpisodes(query, opts)`** is what the tool calls: query the index, apply `opts.filter` (`kind` / `participantIds` / `timeRange`), return `EpisodeSearchResult[]` (`{ episode, score, distance }`) highest-`score`-first.

```ts
// Out-of-band worker (Station signal / cron / queue). Index type is your choice.
const pending = await adapter.findEpisodesNeedingEmbedding({ limit: 100 });
const artifacts = await buildIndex(pending.map((p) => p.content)); // vectors | FTS docs | BM25 postings
for (let i = 0; i < pending.length; i++) await adapter.setEmbedding(pending[i].id, artifacts[i]);
```

Contract rules (match the reference adapter): `supportsSemanticSearch: true` is the switch that folds the search tool — without it `searchEpisodes` is dead code; a just-written episode is searchable only after the worker catches up (eventual consistency — `find`/`timeline` see it immediately); `searchEpisodes` must honor `opts.filter`, sort by `score` desc, and strip `provenance`; normalize relevance to [0,1] before the recency blend (`(1 - recencyWeight) * relevance + recencyWeight * recencyScore`, default `recencyWeight = 0.2`, 30-day half-life) since BM25 scores are unbounded; re-flag on content change only; `setEmbedding`'s `vector` param is only meaningful for a vector index — for lexical/external indexes ignore it and treat `setEmbedding` as "write doc + mark fresh" (still required by the interface).

### Reconciliation primitives

The package's contract is deliberately narrow: store, query, write, search. It does **not** cascade across adapters. When an entity is merged or deleted, episodes that reference its old ID don't auto-update. Orchestrators reach for these primitives:

| Action | Primitive |
|--------|-----------|
| Entity merged | `episodic.replaceParticipantId(oldId, newId, prov)`, `resources.replaceLinkTarget("entity", oldId, newId, prov)` |
| Entity deleted | `episodic.findEpisodes({ where: { participantIds: [id] } })`, `resources.linksFor("entity", id)` then orchestrator decides |
| Resource moved | `resources.replaceLinkTarget("resource", fromPath, toPath, prov)` |
| Episode deleted | `resources.linksFor("episode", id)` then orchestrator decides |
| Stale embeddings | `findEpisodesNeedingEmbedding` / `findFilesNeedingEmbedding` → `embed` → `setEmbedding` |

### Reference in-memory adapters

For dev / tests / quick prototypes. All exported from `glove-memory/in-memory` (and re-exported from the barrel).

```ts
import {
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
} from "glove-memory";

const entity = new InMemoryEntityAdapter({ schema });
const episodic = new InMemoryEpisodicAdapter({ schema, embedder });   // omit embedder → supportsSemanticSearch = false
// Embedding-free content search: `{ schema, fuzzySearch: true }` runs in-process
// lexical/fuzzy search over episode content — no embedder, no external service,
// supportsSemanticSearch = true. `embedder` wins if both are supplied.
const resources = new InMemoryResourcesAdapter({ schema, embedder }); // ditto
const context = new InMemoryContextAdapter({ schema });
```

Process-local — they lose data on restart. Production projects swap in a companion package or BYO adapter.

### Forms — structured collection over a conversation

Definitions are **code**. Zod schemas, gate closures and executors colocate in one type-threaded builder chain, and the agent never reads the definition — it reads a projection of evaluated state.

```ts
import { z } from "zod";
import { defineForm } from "glove-memory/forms";

export const travelClaim = defineForm({
  id: "travel-claim",
  version: 1,
  name: "Travel reimbursement claim",
  description: "Claimant, trip, travel and approval details.",
  conduct: "Conversational — one or two questions at a time. Don't read the field list aloud.",
})
  .step("claimant", { title: "Claimant", preview: "name, staff id, email" }, (s) =>
    s
      .field("fullName", { schema: z.string().min(2), label: "Full name" })
      .field("email", { schema: z.string().email(), label: "Work email" }),
  )
  .step(
    "travel",
    { title: "Travel", preview: "mode, mileage or ticket", when: (v, s) => s.stepComplete("claimant") },
    (s) =>
      s
        .field("mode", { schema: z.enum(["car", "rail", "air"]), label: "Mode" })
        .field("mileage", {
          schema: z.number().int().min(1).optional(),
          label: "Miles driven",
          when: (v) => v.mode === "car",          // applicability, not ask-order
        }),
  )
  .checkpoint("policy-cap", {
    when: (v) => typeof v.total === "number" && v.total > 750,
    blocking: true,
    run: () => ({ fail: "Over the limit — needs Finance pre-approval." }),
  })
  .onComplete(async (ctx) => {
    await ctx.memory.upsertNode("Person", { name: ctx.values.fullName });
  })
  .build();
```

Each `.field()` widens the accumulated values type, so `ctx.values.mode` narrows to its enum union and `ctx.values.mileage` is `number | undefined` at every downstream callsite.

**Optionality and type are derived, never declared.** There is no `required` option — a field is optional iff its schema accepts `undefined`, the same predicate the inferred values type is built from. The `type` string the agent reads comes from `z.toJSONSchema` plus a renderer (`"email address"`, `"one of: car | rail | air"`, `"integer >= 1"`). Together those delete the field-type vocabulary: no type union, no registry, nothing to extend.

**Writes are never gated.** No lock, no locked-field error. `glove_form_fill` takes a patch of *any* field ids, validates each independently so one bad value doesn't reject the rest, and keeps what isn't applicable yet as a **held** entry rather than dropping it. A user who answers question six while being asked question two has answered question six. Field ids are forgiving too — `full_name`, `Full name` and `fullName` all resolve to the same field via a compile-time alias index; an id that still misses comes back with `did_you_mean`.

Sequence splits into two unrelated things: `when` decides whether a field *means anything* given current answers; steps decide what to *steer toward*.

**Skipping is an explicit resolution without a value.** Set `skippable: true` (default false, independent of Zod optionality), then call `runner.skip("website", "User has no website")` or `glove_form_revise({ action: "skip", field: "website", reason: "User has no website" })`. Require a non-empty reason. The field becomes `skipped`, stops being asked, and counts toward completion without a value or `onFill`. `onSkip(ctx)` receives `ctx.reason` plus normal executor context and supports all effects. It fires on entry into the applicable skipped state, not on repeated skips; use `ctx.idempotencyKey` for external effects and `runner.resumeHooks()` for interrupted batches. Undo/redo and held branches preserve reasons; retract reopens; fill/revise can supply a real answer. Preparation never replaces an active skip. Skippable values are typed as possibly undefined. See [workflows.md](memory-and-workflows.md#skipping-a-field-without-inventing-a-value) for the full contract.

**Nothing is ever lost.** `entries` maps each field to an append-only log of revisions plus a cursor naming the one in force. A correction appends rather than overwrites. A retraction is itself a revision, which makes `retract` / `undo` / `redo` pure cursor moves over a log that cannot lose an answer — and every one of them reversible.

```ts
await runner.retract("ticketReference"); // withdraw, keeping the answer
await runner.undo();                     // last answer anywhere on the form
await runner.redo("mileage");            // or on one field
await runner.history("mileage");         // every answer ever given
```

The agent reaches answer changes and skips through `glove_form_revise`'s `action` (`set` / `skip` / `retract` / `undo` / `redo`) rather than separate verbs — tool schemas are re-sent on every model call, and an agentic eval put them at ~75% of this surface's whole context cost.

**Executors** colocate at five points — `field.onFill`, `field.onSkip`, `step.onComplete`, `checkpoint.run`, `form.onComplete` — dispatched commit-then-run on **rising edges only**, with a per-occurrence idempotency key. Verified firing order within one commit: `field.onFill` → `field.onSkip` → `step` → `checkpoint` → `form`. An executor returns `{ patch }`, `{ fail }`, `{ jump }` or `{ complete }`; `ctx.memory` bridges to the other four subsystems with engine-supplied provenance.

**Triggers steer the conversation.** A checkpoint is a trigger — a condition over values, fired on its rising edge. Returning `{ jump }` moves the open step, forward *or back to a step that already finished*:

```ts
.checkpoint("verify-identity", {
  when: (v) => v.claimValue > 10_000,
  run: () => [{ patch: { verificationRequired: true } }, { jump: "claimant" }],
})
```

An executor may return one effect or an array, so a router can stamp a value *and* move in one firing. A backwards jump is a **revisit**: the step's answers stay `filled` but come back with `ask: true`, and tier 0 says `back at step 1/3 "Claimant" — go through it again` (even on an otherwise-complete form). The override is released by the next write into that step, so a jump nudges rather than pins; a jump at a step that doesn't exist is ignored.

**Routing on state, not just values.** `when` *and* `run` each get a `FormState` — `stepComplete(id)`, `checkpointFired(id)`, `complete` — alongside typed values, so a router branches on where the conversation has been:

```ts
.checkpoint("route", {
  when: (v, s) => Boolean(v.kind) && s.stepComplete("triage"),
  run: (ctx) => ({ jump: ctx.values.kind === "complex" ? "complex" : "simple" }),
})
```

`checkpointFired` reads the counters the gate saw, so asking inside a checkpoint's own `run` reports whether it fired *before*, not the firing in progress.

**Terminating collection.** `{ terminate: reason }` stops the form — for ineligible / duplicate / withdrawn, where carrying on is wrong rather than merely unfinished. Distinct from the two that already existed: `fail` records a rejection and continues; `complete` claims success. `terminate` closes the instance with `closedReason`, stops every field asking, refuses further writes, drops it out of tier 0, and beats a completion landing on the same commit.

**Lazy loading, three tiers.** Tier 0 is one transient line appended at the model-input tail before each iteration — open step, its pending field *labels*, and a one-line `preview` per remaining step. Tier 1 (`glove_form_status`) is the open step in full. Tier 2 (`glove_form_inspect`) is any other step, a field, or the whole outline. Form modules aren't imported until started, so `glove_form_list` costs a name and a description.

```
[form: travel-claim] step 2/4 "Trip" · pending: Destination, Departure date
later: Travel (mode, mileage or ticket) · Approval (cost centre, manager)
```

**Wiring:**

```ts
const registry = new FormRegistry().register("travel-claim", {
  name: "Travel reimbursement claim",
  description: "Claimant, trip, travel and approval details.",
  load: () => import("./forms/travel-claim").then((m) => m.travelClaim),
});

const { runner } = useFormRunner(glove, new InMemoryFormAdapter({ schema }), {
  registry,
  subject: conversationId,
  memory: { entity, episodic, resources, context },
});
```

`useFormRunner` folds the seven tools and registers a runtime context provider (`addContextProvider`) that appends the tier-0 line at the model-input tail before every model call (`injectStatus: false` turns it off). It wraps `processRequest` only when `preparation` is configured, to reconcile evidence before each request. It returns the runner so a host can start instances and resolve checkpoints without going through the model. `useFormReader` gives another agent read-only access to past fills.

**Writing a `FormAdapter`** — storage and retrieval only; the engine holds every semantic. Four invariants:

1. **`entries` appends, never replaces.** `commitInstance` receives a per-field `{ append?, cursor? }`, not a replacement history. Overwriting the log destroys answers the design guarantees are kept. `applyEntryCommit` is exported so you can reuse the exact semantics.
2. **`version` is compare-and-set.** Reject a stale `ifVersion` with `FormConflictError`; bump on every write that lands.
3. **A commit is all-or-nothing** — entries, occurrence counters, dispatch log and status together.
4. **Reads hand back snapshots.**

Everything else is the implementer's: storage engine, schema, indexing, retention, *how* atomicity is achieved, provenance depth, multi-tenancy, encryption. Per-method detail is in doc comments on `FormAdapter`.

**Operational notes worth knowing:** a recorded executor failure is not retried (at-least-once covers a crash *before* the outcome was recorded); a hung blocking checkpoint holds the instance `awaiting` until `resolveCheckpoint`, with no timeout; `recordDispatch` writes outside the CAS envelope; an all-optional step is complete at start, so its `onComplete` fires immediately; a *complete* instance stays reachable for corrections — only `abandon` closes a form.

### Out of scope

- Triggering, scheduling, or pipeline orchestration ([Station](https://station.dterminal.net)'s territory).
- Curation logic itself (configured by the consumer).
- Embedding *generation* — consumers plug in their own `EmbeddingAdapter`.
- Schema persistence or migration — schema lives in code only.
- Cross-adapter cascade on entity merge, episode delete, or resource rename — that's reconciliation, an orchestrator responsibility.
- The user-side write path for context — the adapter exposes `set` / `update` / `unset`; the UI / API / form / wherever users edit their preferences calls those directly.
- Binary resources. Resources is text-only.
- `.` and `..` path resolution. All resource paths are absolute.

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Define the ontology | `MemorySchema` from `glove-memory/core` |
| Required write metadata | `Provenance` from `glove-memory/core` |
| Cross-reference between subsystems | `Link` from `glove-memory/core` |
| Embedding contract | `EmbeddingAdapter` from `glove-memory/core` |
| Entity contract | `EntityMemoryAdapter` from `glove-memory/entity` |
| Episodic contract | `EpisodicMemoryAdapter` from `glove-memory/episodic` |
| Resources contract | `ResourceFsAdapter` from `glove-memory/resources` |
| Context contract | `ContextAdapter` from `glove-memory/context` |
| Forms contract | `FormAdapter` from `glove-memory/forms` |
| Define a form | `defineForm` from `glove-memory/forms` |
| Form registry (lazy module load) | `FormRegistry` from `glove-memory/forms` |
| Form engine (host-side) | `FormRunner` from `glove-memory/forms` |
| Reuse append+clamp in an adapter | `applyEntryCommit` from `glove-memory/forms` |
| Reader / curator helpers | `useMemoryReader` / `useMemoryCurator`, `useEpisodicReader` / `useEpisodicCurator`, `useResourcesReader` / `useResourcesCurator`, `useContext`, `useFormRunner` / `useFormReader` from `glove-memory/tools` |
| Narrow the folded tool surface | `{ tools: { allow, deny } }` on any `use*` helper; `selectTools`, `ToolSelection` from `glove-memory/tools` |
| Gate resources by path | `withResourceAccess`, `ResourceAccessControl`, `getResourceAccessControl`, `ResourceAccessPolicy` from `glove-memory/resources` |
| Merge a shared + private store into one view | `layerEntity` / `layerEpisodic` / `layerResources` / `layerContext`, `MemoryLayer` from `glove-memory/layered` |
| Reference in-process adapters | `InMemoryEntityAdapter`, `InMemoryEpisodicAdapter`, `InMemoryResourcesAdapter`, `InMemoryContextAdapter`, `InMemoryFormAdapter` from `glove-memory/in-memory` |
| Error classes | `MemoryError`, `MemoryNotFoundError`, `MemorySchemaError`, `MemoryQueryError`, `MemoryWriteError`, `MemoryToolSelectionError`, `MemoryLayerError`, `EpisodicMemoryError`, `ResourceFsError`, `ResourceAccessError`, `ContextError`, `FormError` / `FormConflictError` / `FormStaleError` / `FormBlockedError` / `FormDefinitionError` from `glove-memory/core` |

See [api-reference.md — `glove-memory`](api-reference.md) for full type signatures, and [examples.md — Memory](examples.md) for worked examples (schema definition, subagent-delegated reader, curator composition, context flow, form definition).

## Goals, facts, and form preparation

Use this reference when building goal-driven agents, retaining early evidence, or preparing form answers from information already supplied.

### Package and tool discovery

- Dynamic goals ship in `glove-memory@1.2.0` under `glove-memory/goals`, also exported at the package root. There is no separate `glove-goals` package.
- Import `GoalRunner`, `defineGoalProgram` and goal types from `glove-memory/goals`; `useGoalRunner` and `buildGoalRunnerTools` from `glove-memory/tools`; `InMemoryGoalAdapter` from `glove-memory/in-memory`.
- Forms use `defineForm`, `FormRegistry`, and `FormRunner` from `glove-memory/forms`, and `useFormRunner` from `glove-memory/tools`.
- Shared evidence ships separately as `glove-facts@0.1.0`: `FactStore`, `InMemoryFactAdapter`, `FactPreparation`, `useFacts`, and `buildRecordFactTool` are root exports.
- `useGoalRunner` mounts the `glove_goal_*` tools; `useFormRunner` mounts `glove_form_*`; `useFacts` mounts `record_fact`. Merely importing the classes does not expose tools to an agent.

### Runtime visibility and caching

Use glove-core >=4.0.0 with glove-memory >=2.0.0. Goals, forms, and pinned context register live providers through `addContextProvider`. Glove appends current state as transient user-role messages after saved history before each model iteration, including after tool results. State stays in its scoped adapter; snapshots never rewrite the system prompt or become saved conversation messages. `runtime_context` subscriber events expose resolved snapshots for tracing. Prefix stability does not guarantee provider cache hits.

Runnable proxies must forward `addContextProvider` and `getRuntimeContext`. Forms/goals can opt out with `injectStatus: false` and a custom renderer. Preparation and lifecycle synchronization still run before mounted requests; reading a snapshot does not run inference. Realtime voice silently injects changed snapshots at start and after tools; call `await realtime.refreshContext()` after external changes. Voice providers retain earlier injected snapshots in their session, superseded by the latest one.

### Skipping a field without inventing a value

Set `skippable: true` on fields that may be resolved without a value. It defaults to `false`, including on optional fields. Optionality still comes from Zod; skipping is a separate, explicit decision with a non-empty reason.

```ts
.field("website", {
  label: "Website",
  schema: z.url(),
  skippable: true,
  async onSkip(ctx) {
    // notifyIntakeTeam is supplied by your application.
    await notifyIntakeTeam({ reason: ctx.reason, idempotencyKey: ctx.idempotencyKey });
  },
})

await runner.skip("website", "User has no website");
// Agent tool: glove_form_revise({ action: "skip", field: "website",
//   reason: "User has no website" })
```

An applicable skipped field has `status: "skipped"`, `ask: false`, and `skipReason` (`skip_reason` in tool output). It counts as resolved for step/form completion, but contributes nothing to `values` or `held` and never fires `onFill`. The builder types skippable values as possibly `undefined`, even in completion hooks. Outline summaries count `filled` and `skipped` separately. While collecting, runtime context carries skip reasons so the agent does not ask again; a finished form remains available through inspect/history.

`onSkip` receives the normal executor context plus `reason`. It fires when the field enters an applicable skipped state. A repeated skip or reason change does not fire it again; undo followed by redo, or leaving and re-entering an applicable branch, can create a new occurrence. It supports the same effects as other hooks: `patch`, `fail`, `jump`, `complete`, `terminate`, or an array. Dispatch order is `onFill` → `onSkip` → step completion → checkpoints → form completion. External side effects must deduplicate `ctx.idempotencyKey`. Skip-triggered hook batches persist before execution; call `runner.resumeHooks()` after an interruption. A recorded hook failure is surfaced without rolling back the skip or automatically retrying the failed hook.

Skips are append-only revisions (`FormEntry.skipped: { reason }`), so undo/redo preserve both prior answers and reasons. `fill` or `revise` replaces a skip with an answer; `retract` reopens it. Automatic fact preparation never overwrites an active skip, even if new evidence arrives. If the field is inapplicable, the skip remains held with its reason and takes effect, including `onSkip`, when it becomes applicable. A revisit does not ask skipped fields again. Custom adapters must preserve skip metadata and pending hook batches. Do not record silence as a skip or use `"N/A"` as a placeholder value.

### Agent-backed preparation

The caller supplies a dedicated, built `IGloveRunnable` with its model, store and tracing subscribers already configured. The library manages preparation through that agent's normal `processRequest` path. It appends `submit_preparation` once, on the first preparation run, preserving existing tools and the system prompt. Model events, usage, tool execution/results and conversation history remain observable through the supplied agent.

```ts
import type { IGloveRunnable } from "glove-core";
import { FactPreparation, type FactStore } from "glove-facts";

export function makePreparer(facts: FactStore, agent?: IGloveRunnable) {
  return new FactPreparation(facts, { agent });
}
```

Agent presence enables automatic preparation. Omit the agent to keep capture/manual progression without automatic inference, claims or prefilling. Set `preparer.config.agent` to a built agent or `undefined` to affect subsequent operations; an in-flight request retains its starting agent. Do not use the removed `createModelPreparation`, an `inference` callback, a raw model call, or a separate `enabled` flag.

Use a separate preparation agent and store per exact fact scope. Goals and forms in that scope may share it. Do not use the workflow's conversational agent as its own preparation agent. The library serializes preparation on a supplied agent and rejects scope/history mismatches. Avoid concurrent unrelated requests on it. Preparation-agent tools/hooks must not re-enter the same fact store or workflow while the fact scope lock is held.

### Shared integration

The following helper mounts both workflows on a caller-supplied conversational agent. The caller provides the separate preparation agent; each adapter here is process-local and must be replaced for durable production use.

```ts
/** Use one evidence store for both workflows. Supply your own conversational and preparation agents
 * and durable adapters in production; the reference adapters are process-local. */
import type { IGloveRunnable } from "glove-core";
import { z } from "zod";
import { FactStore, FactPreparation, InMemoryFactAdapter, useFacts } from "glove-facts";
import { defineForm, defineGoalProgram, FormRegistry, MemorySchema, InMemoryFormAdapter, InMemoryGoalAdapter } from "glove-memory";
import { useFormRunner, useGoalRunner, type FormEnableTarget } from "glove-memory/tools";

export async function sharedEvidence(glove: FormEnableTarget, preparationAgent: IGloveRunnable, currentMessageId: () => string) {
  const subject = "tenant:1/client:2";
  const facts = new FactStore(new InMemoryFactAdapter(), { scope: { subject, context: "matter:3" } });
  useFacts(glove, facts, () => {
    const id = currentMessageId();
    return { source: { kind: "message", id }, operationId: id };
  });
  const preparer = new FactPreparation(facts, { agent: preparationAgent });
  const rule = { kind: "information" as const, criteria: "Client's preferred contact email" };
  const registry = new FormRegistry().register("contact", {
    name: "Contact", description: "Client contact details",
    load: () => defineForm({ id: "contact", version: 1, name: "Contact", description: "Client contact details" })
      .step("details", { title: "Contact details" }, s => s.field("email", { label: "Email", schema: z.email() })).build(),
  });
  const { runner: forms } = useFormRunner(glove, new InMemoryFormAdapter({ schema: new MemorySchema() }), {
    registry, subject, preparation: { preparer, rule: field => field.id === "email" ? rule : undefined },
  });
  const { runner: goals } = useGoalRunner(glove, new InMemoryGoalAdapter(), {
    scope: { subject, key: "intake" }, preparation: { preparer, rule: (_goal, item) => item.key === "email" ? rule : undefined },
  });
  await facts.record({ text: "Ada's preferred contact email is ada@example.com.", value: "ada@example.com",
    source: { kind: "document", id: "contract:contact-details" }, verification: "verified",
  }, { operationId: "contract:contact-details/email" });
  await goals.start(defineGoalProgram({ key: "intake", goals: [{ key: "contact", title: "Contact", objective: "Know how to contact the client", items: [{ key: "email", label: "Preferred email" }] }] }));
  await forms.start("contact");
  return { facts, preparer, forms, goals };
}
```

The host rule is an allowlist: returning `undefined` leaves a field/item manual. Goal preparation proposes completion (`true`); forms use the field's real Zod schema. The same fact can support both consumers through separate links; facts are never consumed globally.

### Timing and lifecycle

Recording only saves evidence. It does not fan out to every workflow. Preparation runs on new workflow starts, relevant runner commits, before mounted model turns, or explicit `runner.prepare()`. Plain status/inspect reads do not invoke inference. Idempotent no-op goal starts/updates do not force another pass.

Goals retain definitions, versioned progress and stable item keys. Use `runner.revise(program, { ifVersion, reason })` for definition changes and ordinary progress updates for dispositions. A host-owned `eligible` callback can gate automatic completion; default goal preparation considers every live item. Forms reevaluate conditional eligibility as prepared answers open later steps, before their activation/hooks observe state.

Goal lifecycle hooks and `useGoalRunner`'s `configure` callback can project progress into the conversational agent's tools/model/prompt. The host can build a new runnable when constructor/build choices must change. Do not let model-authored goal data become executable hook code or call goal mutations/refresh recursively from configuration.

### Evidence and recovery constraints

- Scope is the exact subject/context tuple; qualify it by tenant/client/matter. Host code owns scope, source and operation identity. `record_fact({ fact, urgent? })` captures unverified prose; it cannot certify actions or approvals.
- Host `facts.record(input, { operationId })` can save verified document/tool evidence. Identical operation retries deduplicate. Corrections use `supersedes: { id, revision }` and retain history.
- Unverified information needs confirmation unless the host information rule explicitly allows it. Actions/outcomes require verified successful evidence with the matching `evidenceKey`; approvals also require an authorized actor. Intentions are not completed actions.
- The model proposes. Source/revision checks, schemas, evidence rules and workflow gates determine authoritative commits. Missing/invalid/failed preparation stays unresolved.
- Corrections or changed criteria flag prior answers/completions for review; they do not silently overwrite existing work or repeat completed actions. Resolve through explicit runner operations. Urgent facts can trigger the host `onUrgent` callback immediately at capture.
- Persist consumer claim receipts with answer/progress history. BYO fact adapters must serialize each scope across workers. Prepared form adapters must retain pending hooks/effects and receipts for recovery. External effects are at least once and need idempotency; do not promise exactly-once delivery.

For full contracts, consult the [facts guide](https://github.com/porkytheblack/glove/blob/main/packages/glove-facts/README.md) and [memory guide](https://github.com/porkytheblack/glove/blob/main/packages/glove-memory/README.md). The [shared-workflow example](https://github.com/porkytheblack/glove/blob/main/packages/glove-memory/examples/shared-facts.ts) is compiled against public package exports.

### Framework context and turn boundaries

Runtime snapshots carry `Message.framework_context: "runtime"`; synthetic inbox entries use `"inbox"`. This optional provenance field does not change provider roles. Tool-result summarization ignores these entries and existing skill/compaction markers when locating the last real user turn. Pending inbox reminders follow complete tool-result bundles. Preserve the marker in custom message processing and preserve structured media when merging adjacent user content.
