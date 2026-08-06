import type { EntityMemoryAdapter, FindNodesOpts } from "../entity/adapter";
import type { MemoryNode, NodeWithNeighbours, NodeWriteResult } from "../entity/types";
import type { NodeFilter, QueryResult, QueryRow, QuerySpec } from "../entity/query";
import type { Provenance } from "../core/provenance";
import { MemoryLayerError, MemoryNotFoundError } from "../core/errors";
import {
  mergeUnique,
  pushDownLimit,
  refuseWrite,
  resolveLayers,
  windowed,
  type MemoryLayer,
} from "./shared";

export type EntityLayer = MemoryLayer<EntityMemoryAdapter>;

/** An `EntityMemoryAdapter` assembled from strata, carrying the stack it merges. */
export interface LayeredEntityAdapter extends EntityMemoryAdapter {
  readonly layers: EntityLayer[];
  /** Which stratum owns a node id, or null when nothing has it. */
  layerOf(id: string): Promise<string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges several `EntityMemoryAdapter`s into one graph.
 *
 * The shape that motivates it: a shared ontology — the organisations,
 * products and people everyone's agent should know — alongside the nodes
 * this agent worked out for itself. `find` / `get` / `query` see one graph.
 *
 * **Writes land in the private stratum, but identity resolves against the
 * shared one first.** `addNode` checks each read-only stratum for a node
 * matching the class's `identityKeys` before writing, and returns that node's
 * id with `created: false` when it finds one. Without that check every agent
 * would grow a private duplicate of every shared entity on first mention,
 * and the graph the layering exists to share would quietly fork. The
 * consequence to know: the id you get back may belong to a read-only
 * stratum, so a follow-up `updateNode` on it is refused — correctly, since
 * the entity is shared and immutable.
 *
 * **Edges cannot straddle strata.** `EntityMemoryAdapter.connect` resolves
 * and validates both endpoints inside one adapter — the private store has no
 * row for a shared node, so it cannot hold an edge pointing at one. A
 * `connect` whose endpoints land in different strata is refused with
 * `MemoryLayerError` (`code: "cross_layer_unsupported"`) rather than
 * half-written. This is the real limitation of layering the graph, and the
 * reason the other three subsystems layer more cleanly: episodic
 * participants and resource links are plain ids that nothing validates, so
 * they cross strata freely. If you need "my note about their company", model
 * it as an episode or a resource link rather than an edge.
 *
 * ```ts
 * const entity = layerEntity([
 *   { name: "ontology", adapter: shared,  access: "read" },
 *   { name: "private",  adapter: personal, access: "write" },
 * ]);
 * useMemoryCurator(glove, entity);
 * ```
 */
export function layerEntity(layers: EntityLayer[]): LayeredEntityAdapter {
  const { all, writable } = resolveLayers(layers, "layerEntity");
  const readOnly = all.filter((l) => l.access !== "write");
  const schema = all[0]!.adapter.schema;

  async function ownerOf(id: string): Promise<EntityLayer | null> {
    for (const layer of all) {
      if (await layer.adapter.getNode(id)) return layer;
    }
    return null;
  }

  async function requireWritable(id: string, operation: string): Promise<void> {
    const owner = await ownerOf(id);
    if (!owner) throw new MemoryNotFoundError(`No node with id "${id}" in any layer.`);
    if (owner.access !== "write") refuseWrite(owner.name, `Node "${id}"`, operation);
  }

  /** Looks for an existing shared node matching any of the class's identity key sets. */
  async function resolveInSharedStrata(
    className: string,
    props: unknown,
  ): Promise<{ id: string; layer: string } | null> {
    if (readOnly.length === 0 || !isRecord(props)) return null;
    const keySets = schema.getNodeClass(className)?.identityKeys ?? [];
    if (keySets.length === 0) return null;
    for (const layer of readOnly) {
      for (const keys of keySets) {
        // A key set only identifies when every key in it has a value.
        if (keys.some((k) => props[k] === undefined || props[k] === null)) continue;
        const where: NodeFilter = {};
        for (const k of keys) where[k] = { eq: props[k] };
        const hits = await layer.adapter.findNodes(className, where, { limit: 1 });
        if (hits.length > 0) return { id: hits[0]!.id, layer: layer.name };
      }
    }
    return null;
  }

  return {
    identifier: `layered(${all.map((l) => l.adapter.identifier).join("+")})`,
    schema,
    layers: all,

    async layerOf(id) {
      return (await ownerOf(id))?.name ?? null;
    },

    // ─── Node writes ──────────────────────────────────────────────────────

    async addNode(className: string, props: unknown, provenance: Provenance): Promise<NodeWriteResult> {
      const shared = await resolveInSharedStrata(className, props);
      if (shared) return { id: shared.id, created: false };
      return writable.adapter.addNode(className, props, provenance);
    },

    async updateNode(id: string, props: Record<string, unknown>, provenance: Provenance) {
      await requireWritable(id, "updating it");
      return writable.adapter.updateNode(id, props, provenance);
    },

    async mergeNodes(keepId: string, mergeId: string, provenance: Provenance) {
      await requireWritable(keepId, "merging into it");
      await requireWritable(mergeId, "merging it away");
      return writable.adapter.mergeNodes(keepId, mergeId, provenance);
    },

    // ─── Edge writes ──────────────────────────────────────────────────────

    async connect(fromId, toId, relType, props, provenance) {
      const from = await ownerOf(fromId);
      const to = await ownerOf(toId);
      if (!from) throw new MemoryNotFoundError(`No source node with id "${fromId}" in any layer.`);
      if (!to) throw new MemoryNotFoundError(`No target node with id "${toId}" in any layer.`);
      if (from.name !== to.name) {
        throw new MemoryLayerError(
          "cross_layer_unsupported",
          `Cannot connect "${fromId}" (layer "${from.name}") to "${toId}" (layer "${to.name}"): an edge has to live in one stratum, and neither store holds both endpoints. Record the association as an episode participant or a resource link instead — those cross strata freely.`,
          from.name,
        );
      }
      if (from.access !== "write") {
        refuseWrite(from.name, `Both endpoints of this edge`, "connecting them");
      }
      return writable.adapter.connect(fromId, toId, relType, props, provenance);
    },

    async disconnect(edgeId: string, provenance: Provenance) {
      // The contract has no `getEdge`, so ownership can't be resolved ahead
      // of the call. Route to the writable stratum and translate its
      // not-found into something that names the real possibility.
      try {
        return await writable.adapter.disconnect(edgeId, provenance);
      } catch (e) {
        if (e instanceof MemoryNotFoundError && readOnly.length > 0) {
          throw new MemoryLayerError(
            "layer_read_only",
            `No edge with id "${edgeId}" in the writable layer "${writable.name}". If it belongs to a read-only layer (${readOnly
              .map((l) => `"${l.name}"`)
              .join(", ")}), it can't be disconnected through the layered view.`,
            writable.name,
          );
        }
        throw e;
      }
    },

    // ─── Reads ────────────────────────────────────────────────────────────

    async getNode(id) {
      for (const layer of all) {
        const node = await layer.adapter.getNode(id);
        if (node) return node;
      }
      return null;
    },

    async findNodes(className: string, where: NodeFilter, opts: FindNodesOpts = {}) {
      const perLayer: FindNodesOpts = { ...opts, offset: undefined, limit: pushDownLimit(opts) };
      const groups = await Promise.all(
        all.map((l) => l.adapter.findNodes(className, where, perLayer)),
      );
      return windowed(mergeUnique<MemoryNode>(groups, (n) => n.id), opts);
    },

    async getNodeWithNeighbours(id: string): Promise<NodeWithNeighbours | null> {
      // Edges never cross strata, so the owning layer's answer is the whole
      // neighbourhood — no merging to do.
      const owner = await ownerOf(id);
      return owner ? owner.adapter.getNodeWithNeighbours(id) : null;
    },

    async query(spec: QuerySpec): Promise<QueryResult> {
      const perLayer: QuerySpec = { ...spec, offset: undefined, limit: pushDownLimit(spec) };
      const results = await Promise.all(all.map((l) => l.adapter.query(perLayer)));
      const merged = mergeUnique<QueryRow>(results.map((r) => r.rows), (row) => row.id);
      return { rows: windowed(merged, spec) };
    },
  };
}
