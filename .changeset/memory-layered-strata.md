---
"glove-memory": minor
---

Memory: layered strata. `layerEntity` / `layerEpisodic` / `layerResources` / `layerContext` (new `glove-memory/layered` subpath) take a stack of adapters and return one adapter of the ordinary contract, so the existing `use*` helpers fold the ordinary tool surface over it.

The shape this exists for: memory arrives in strata. Some is shared and authored elsewhere — an org handbook, a common ontology, published events, standing instructions — and the agent must read it but never change it. Some is the agent's own. The two live in different stores, because a shared corpus can't be copied into every private one, and the agent shouldn't have to know that.

```ts
const resources = layerResources([
  { name: "handbook", adapter: sharedFs,  access: "read", paths: ["/handbook"] },
  { name: "notes",    adapter: privateFs, access: "write" },
]);
useResourcesCurator(glove, resources);
```

Invariants across all four: exactly one `access: "write"` stratum per stack (zero or two throws at construction rather than at the first write); reads merge in layer order, earlier layers winning a collision; writes route to the stratum owning the target and are refused with `MemoryLayerError` (`code: "layer_read_only"`) naming it; `limit`/`offset` apply to the merged result; `setEmbedding` is permitted against read-only strata because indexing runs on the host's behalf, not the agent's.

Resources layers scope with `paths`, and since order is precedence, disjoint prefixes give a mounted arrangement while overlapping ones give a union with private-first shadowing. Paths are not translated — the shared store must be authored under its prefix, or its stored `metadata.links` targets would be silently invalidated. Writes route to whoever already holds a path, which is what makes `remove("/handbook/pay.md")` report a read-only stratum instead of "not found". There is no copy-on-write; cross-stratum moves and recursive removes that would reach a shared stratum are refused.

Entity carries the two consequences worth knowing. `addNode` resolves the class's `identityKeys` against the read-only strata before writing and returns the shared node's id with `created: false`, so a shared graph doesn't fork into a private duplicate per agent — the returned id may then be immutable. And edges cannot straddle strata: `EntityMemoryAdapter.connect` validates both endpoints inside one adapter, so a cross-stratum connect is refused with `code: "cross_layer_unsupported"` rather than half-written. Episodic participants and resource links are unvalidated plain ids and cross strata freely, which is the documented workaround.

Layering composes with the path-scoped access policies rather than replacing them: layering answers which store something lives in, `withResourceAccess` answers what may be done inside one store.
