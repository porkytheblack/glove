import type { ContextAdapter } from "../context/adapter";
import type {
  ContextEntry,
  ContextEntryInput,
  ContextEntryPatch,
  ContextRenderOpts,
} from "../context/types";
import type { Provenance } from "../core/provenance";
import { MemoryLayerError } from "../core/errors";
import {
  mergeUnique,
  refuseWrite,
  resolveLayers,
  type MemoryLayer,
} from "./shared";

export type ContextLayer = MemoryLayer<ContextAdapter>;

/** A `ContextAdapter` assembled from strata, carrying the stack it merges. */
export interface LayeredContextAdapter extends ContextAdapter {
  readonly layers: ContextLayer[];
  /** Which stratum owns an entry id, or null when nothing has it. */
  layerOf(id: string): Promise<string | null>;
}

/**
 * Merges several `ContextAdapter`s into one.
 *
 * The shape that motivates it: standing instructions the org publishes and
 * the agent must not rewrite, alongside the entries this user set for
 * themselves. Both render into the system prompt every turn, and the agent
 * reads one list.
 *
 * Reads merge across strata in order (earlier layers win an id collision).
 * `render` concatenates each stratum's own block **shared first**, so a
 * private entry that refines a shared one reads as the later, more specific
 * word — the same precedence logic that puts user context after the
 * developer's system prompt.
 *
 * Writes go to the single writable stratum. `update` / `unset` against an
 * entry a read-only stratum owns are refused with `MemoryLayerError`
 * (`code: "layer_read_only"`).
 *
 * ```ts
 * const context = layerContext([
 *   { name: "org", adapter: orgContext, access: "read" },
 *   { name: "user", adapter: userContext, access: "write" },
 * ]);
 * useContext(glove, context);
 * ```
 */
export function layerContext(layers: ContextLayer[]): LayeredContextAdapter {
  const { all, writable } = resolveLayers(layers, "layerContext");

  async function ownerOf(id: string): Promise<ContextLayer | null> {
    for (const layer of all) {
      if (await layer.adapter.get(id)) return layer;
    }
    return null;
  }

  async function requireWritable(id: string, operation: string): Promise<void> {
    const owner = await ownerOf(id);
    if (!owner) {
      throw new MemoryLayerError(
        "layer_read_only",
        `No context entry with id "${id}" in any layer.`,
      );
    }
    if (owner.access !== "write") refuseWrite(owner.name, `Context entry "${id}"`, operation);
  }

  return {
    identifier: `layered(${all.map((l) => l.adapter.identifier).join("+")})`,
    schema: all[0]!.adapter.schema,
    layers: all,

    async layerOf(id) {
      return (await ownerOf(id))?.name ?? null;
    },

    async list(section) {
      const groups = await Promise.all(all.map((l) => l.adapter.list(section)));
      return mergeUnique<ContextEntry>(groups, (e) => e.id);
    },

    async get(id) {
      for (const layer of all) {
        const entry = await layer.adapter.get(id);
        if (entry) return entry;
      }
      return null;
    },

    async render(opts?: ContextRenderOpts) {
      const blocks = await Promise.all(all.map((l) => l.adapter.render(opts)));
      return blocks.filter((b) => b && b.length > 0).join("\n\n");
    },

    async set(entry: ContextEntryInput, provenance: Provenance) {
      return writable.adapter.set(entry, provenance);
    },

    async update(id: string, patch: ContextEntryPatch, provenance: Provenance) {
      await requireWritable(id, "updating it");
      return writable.adapter.update(id, patch, provenance);
    },

    async unset(id: string, provenance: Provenance) {
      await requireWritable(id, "unsetting it");
      return writable.adapter.unset(id, provenance);
    },

    async setSection(section, entries, provenance) {
      // Only the writable stratum's entries in this section are replaced —
      // shared entries in the same section survive and keep rendering. The
      // alternative (refusing whenever a read-only layer also uses the
      // section) would make a shared section name poison a user's whole
      // preferences pane.
      return writable.adapter.setSection(section, entries, provenance);
    },

    async unsetSection(section, provenance) {
      return writable.adapter.unsetSection(section, provenance);
    },
  };
}
