/**
 * Layered memory — several adapters per subsystem presented to the agent as
 * one.
 *
 * The shape this exists for: memory arrives in strata. Some of it is shared
 * and authored elsewhere, and the agent must be able to read it but never
 * change it. Some of it is the agent's own, and it may do as it likes. The
 * two live in different stores, because a shared corpus can't be duplicated
 * into every private one — but the agent shouldn't have to know that. Each
 * `layer*` function takes the stack and returns an adapter of the ordinary
 * contract, so the existing `use*` helpers fold the ordinary tool surface
 * over it.
 *
 * ```ts
 * const resources = layerResources([
 *   { name: "handbook", adapter: sharedFs,  access: "read", paths: ["/handbook"] },
 *   { name: "notes",    adapter: privateFs, access: "write" },
 * ]);
 * useResourcesCurator(glove, resources);
 * ```
 *
 * Every stack takes exactly one `access: "write"` stratum. Reads merge in
 * layer order; writes route to whichever stratum owns the target, and are
 * refused with `MemoryLayerError` when that stratum is read-only.
 *
 * This composes with `withResourceAccess` rather than replacing it: layering
 * answers "which store does this live in", path policies answer "what may be
 * done inside one store". Wrap a layer's adapter to gate it further, or wrap
 * the layered adapter to gate the merged view.
 */
export {
  resolveLayers,
  type LayerAccess,
  type MemoryLayer,
  type ResolvedLayers,
} from "./shared";
export { layerEntity, type EntityLayer, type LayeredEntityAdapter } from "./entity";
export { layerEpisodic, type EpisodicLayer, type LayeredEpisodicAdapter } from "./episodic";
export {
  layerResources,
  type ResourceLayer,
  type LayeredResourceFsAdapter,
} from "./resources";
export { layerContext, type ContextLayer, type LayeredContextAdapter } from "./context";
