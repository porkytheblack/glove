# glove-memory

## 1.1.1

### Patch Changes

- Updated dependencies [[`3dad3ab`](https://github.com/porkytheblack/glove/commit/3dad3ab965ef4dff1973fa7339a60ae8f24b90e8), [`ee591da`](https://github.com/porkytheblack/glove/commit/ee591da42305661339913bca8f967a9f8c0fecbf)]:
  - glove-core@3.7.0

## 1.1.0

### Minor Changes

- [#38](https://github.com/porkytheblack/glove/pull/38) [`fb2d7ca`](https://github.com/porkytheblack/glove/commit/fb2d7ca8647a1625b8fd65e9ceee2fa0e13b57f5) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Episodic memory: embedding-free fuzzy search. `InMemoryEpisodicAdapter` now accepts `fuzzySearch: true` (no embedder) to run in-process lexical/fuzzy matching over episode content — exact-phrase and substring hits plus a bigram-Dice typo-tolerant fallback. It sets `supportsSemanticSearch: true` (so `glove_episodic_search` is registered) with zero external services, no vectors, and no out-of-band embed loop. `embedder` still takes precedence when both are supplied. Clarifies that `supportsSemanticSearch` advertises that `searchEpisodes` is callable, not how it ranks, so BYO adapters can offer fuzzy, embedding, or hybrid search behind the same contract.

- [#65](https://github.com/porkytheblack/glove/pull/65) [`a7823c5`](https://github.com/porkytheblack/glove/commit/a7823c5e396f4d555885bed813cbe66c9bf3c2ef) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Forms: structured collection over a conversation, as a fifth memory subsystem. Definitions are code — `defineForm(...).step(...).field(...).checkpoint(...).onComplete(...).build()` — with zod schemas, gate closures and executors colocated in one type-threaded builder chain, so `ctx.values` narrows to the real shape at every callsite. `required` and the agent-facing `type` string are both derived from the schema (`safeParse(undefined)` and `z.toJSONSchema`), so there is no field-type vocabulary and no flag that can disagree with the inferred values type.

  Writes are never gated: `glove_form_fill` takes a patch of any field ids, validates each independently, and keeps what isn't applicable yet as a held entry rather than dropping it. Liveness is recomputed on each commit by a shrink-only repartition, so a correction that orphans an answer is always recoverable by changing it back. Completion counts applicable required fields only.

  Storage is per-field history: `entries` maps each field to an append-only log of revisions plus a cursor saying which one is in force. Nothing is ever removed or rewritten, so §5.1's "nothing is ever deleted" is literally true of revisions and not just of applicability changes. A retraction is itself a revision, which makes `retract`, `undo` and `redo` pure cursor moves over a log that cannot lose an answer — and makes every one of them reversible. All four moves ride on `glove_form_revise` behind an `action` parameter rather than three new tools, because tool schemas are re-sent on every completion call and an eval measured them at roughly three quarters of this surface's whole context cost.

  Executors colocate at four points (`field.onFill`, `step.onComplete`, `checkpoint.run`, `form.onComplete`) behind one signature, dispatched commit-then-run and at-least-once with a per-occurrence idempotency key, and can hand back `{ patch }`, `{ fail }`, `{ jump }` or `{ complete }`. `ctx.memory` bridges to entity, episodic, resources and context with engine-supplied provenance.

  Field ids resolve through a compile-time alias index built over normalised ids _and_ labels, so `full_name`, `Full name` and `fullName` all land on the same field; `compileForm` rejects any definition whose fields would collide once case and punctuation are stripped, so resolution is never a guess. Ids that still don't resolve come back with `did_you_mean` suggestions instead of a bare rejection. An agentic evaluation across four models found this was the largest source of friction on the surface — 17% of write calls had every field rejected — and fixing it took the collection rate from 69% to 85%.

  Type strings name what the schema accepts, not a friendly paraphrase of it: a boolean renders as `true or false`, because rendering it as `yes / no` had models sending the literal string `"yes"` for half of all writes to a boolean field and then looping on the rejection. A type mismatch on a quoted number or boolean gets a hint naming the JSON shape to send.

  A checkpoint is a trigger — a condition over values, fired on its rising edge — and `{ jump }` lets it steer the conversation. Forward was already supported; a jump _back_ to a step that had already completed was silently dropped, which is the one thing a routing trigger could ask for and not get. A backwards jump is now a **revisit**: the step reopens, its answers stay `filled` but come back with `ask: true`, `FormView.revisiting` is set, and tier 0 renders `back at step N/M "Title" — go through it again` even on an otherwise-complete form. The override is released by the next write into that step, so a jump nudges rather than pins. An executor may now return an array of effects, so a router can stamp a derived value and move in the same firing.

  Executors receive the same `FormState` their gates do — `stepComplete`, `checkpointFired`, `complete` — so a router branches on where the conversation has been, not only on the values it holds; `checkpointFired` reads the counters the gate saw, so it reports prior firings rather than the one in progress. `{ terminate: reason }` stops collection outright for the ineligible / duplicate / withdrawn cases, closing the instance with `closedReason`, stopping every field asking, refusing further writes, and beating a completion that would otherwise have landed on the same commit.

  Loading is tiered like the inbox: a one-line tier-0 notification injected into the system prompt each turn (open step, pending labels, one-line preview per remaining step), `glove_form_status` for the open step in full, `glove_form_inspect` for anything else. Form modules aren't imported until a form is started — `glove_form_list` renders registration data only.

  `FormAdapter` is documented as a storage-and-retrieval contract: four invariants the engine relies on (entries append rather than replace, `version` is compare-and-set, a commit is all-or-nothing, reads hand back snapshots), a per-method note on what to set and which error to throw, and an explicit list of what is left to the implementer — storage engine, indexing, retention, how atomicity is achieved, how much provenance to keep. `applyEntryCommit` is exported so an adapter can reuse the append-and-clamp semantics rather than re-derive them.

  Adds `glove-memory/forms`, `InMemoryFormAdapter`, `useFormRunner` / `useFormReader`, the `FormAdapter` contract, and the `form_conflict` / `form_validation_failed` / `form_blocked` / `form_stale` / `form_definition_error` error codes.

- [#79](https://github.com/porkytheblack/glove/pull/79) [`eb277a4`](https://github.com/porkytheblack/glove/commit/eb277a4ad1a75848a729c9141cfbc02fe1972ccb) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Memory: layered strata. `layerEntity` / `layerEpisodic` / `layerResources` / `layerContext` (new `glove-memory/layered` subpath) take a stack of adapters and return one adapter of the ordinary contract, so the existing `use*` helpers fold the ordinary tool surface over it.

  The shape this exists for: memory arrives in strata. Some is shared and authored elsewhere — an org handbook, a common ontology, published events, standing instructions — and the agent must read it but never change it. Some is the agent's own. The two live in different stores, because a shared corpus can't be copied into every private one, and the agent shouldn't have to know that.

  ```ts
  const resources = layerResources([
    {
      name: "handbook",
      adapter: sharedFs,
      access: "read",
      paths: ["/handbook"],
    },
    { name: "notes", adapter: privateFs, access: "write" },
  ]);
  useResourcesCurator(glove, resources);
  ```

  Invariants across all four: exactly one `access: "write"` stratum per stack (zero or two throws at construction rather than at the first write); reads merge in layer order, earlier layers winning a collision; writes route to the stratum owning the target and are refused with `MemoryLayerError` (`code: "layer_read_only"`) naming it; `limit`/`offset` apply to the merged result; `setEmbedding` is permitted against read-only strata because indexing runs on the host's behalf, not the agent's.

  Resources layers scope with `paths`, and since order is precedence, disjoint prefixes give a mounted arrangement while overlapping ones give a union with private-first shadowing. Paths are not translated — the shared store must be authored under its prefix, or its stored `metadata.links` targets would be silently invalidated. Writes route to whoever already holds a path, which is what makes `remove("/handbook/pay.md")` report a read-only stratum instead of "not found". There is no copy-on-write; cross-stratum moves and recursive removes that would reach a shared stratum are refused.

  Entity carries the two consequences worth knowing. `addNode` resolves the class's `identityKeys` against the read-only strata before writing and returns the shared node's id with `created: false`, so a shared graph doesn't fork into a private duplicate per agent — the returned id may then be immutable. And edges cannot straddle strata: `EntityMemoryAdapter.connect` validates both endpoints inside one adapter, so a cross-stratum connect is refused with `code: "cross_layer_unsupported"` rather than half-written. Episodic participants and resource links are unvalidated plain ids and cross strata freely, which is the documented workaround.

  Layering composes with the path-scoped access policies rather than replacing them: layering answers which store something lives in, `withResourceAccess` answers what may be done inside one store.

- [#79](https://github.com/porkytheblack/glove/pull/79) [`671c913`](https://github.com/porkytheblack/glove/commit/671c913657f58ae928ac23d752d10425293a6a5f) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Memory: hold back what the agent may do, two independent ways.

  **Tool allowlists.** Every `use*` helper now takes an options bag selecting which tools of the surface get folded — `useResourcesCurator(glove, resources, { tools: { deny: ["remove", "move"] } })`, `useContext(glove, ctx, { tools: { allow: ["get"] } })`, `useFormRunner(..., { tools: { deny: ["abandon"] } })`. Names resolve in full (`"glove_resources_remove"`) or short (`"remove"`); `allow` narrows first, `deny` subtracts. A selector matching nothing throws `MemoryToolSelectionError` rather than silently doing nothing, since a typo in a `deny` entry would otherwise leave the tool registered. `selectTools` is exported for surfaces you build yourself.

  **Path-scoped access policies.** `withResourceAccess(adapter, policy)` wraps a `ResourceFsAdapter` so every call is checked against per-path modes — `"write"`, `"read"` (readable, every mutation refused with `ResourceAccessError`), `"none"` (invisible, and filtered out of `ls` / `grep` / `glob` / `search` / `links_for` results). Rules take a directory prefix or a glob and cascade last-match-wins over a `default`. Enforcement is on the adapter, not the tool list, so a write into a read-only folder is refused whichever tool asks: the affordance and the capability are removed separately, and the two compose.

  Recursive removes and directory moves are checked against the whole subtree, so `rm -r /` can't take a protected folder with it; directories on the path to a granted subtree stay listable so an allowlist policy is still navigable; and the active policy is rendered into every resource tool description (`describe: false` suppresses the text, never the enforcement).

### Patch Changes

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
