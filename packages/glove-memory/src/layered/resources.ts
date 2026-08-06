import type { ResourceFsAdapter } from "../resources/adapter";
import type {
  DirectoryEntry,
  GrepMatch,
  GrepSpec,
  ResourceBody,
  ResourceMetadata,
  ResourceSemanticSearchOpts,
  SemanticMatch,
} from "../resources/types";
import { isWithin, normalisePath } from "../resources/paths";
import type { Provenance } from "../core/provenance";
import { MemoryLayerError } from "../core/errors";
import { mergeUnique, refuseWrite, resolveLayers, type MemoryLayer } from "./shared";

export interface ResourceLayer extends MemoryLayer<ResourceFsAdapter> {
  /**
   * Absolute path prefixes this stratum serves. Defaults to `["/"]` — the
   * whole tree.
   *
   * Paths are **not** translated: a layer scoped to `/handbook` serves
   * `/handbook/pay.md` by calling its adapter with that same absolute path,
   * so the shared store must already be authored under that prefix.
   * Translating would silently invalidate every `metadata.links` target and
   * every `linksFor` answer stored in it, which is too high a price for the
   * convenience of mounting a corpus authored at its own root.
   */
  paths?: string[];
}

/** A `ResourceFsAdapter` assembled from strata, carrying the stack it merges. */
export interface LayeredResourceFsAdapter extends ResourceFsAdapter {
  readonly layers: ResourceLayer[];
  /** Which stratum serves a path today, or null when nothing has it. */
  layerOf(path: string): Promise<string | null>;
}

function prefixesOf(layer: ResourceLayer): string[] {
  const paths = layer.paths ?? ["/"];
  return paths.map(normalisePath);
}

/** True when the layer is responsible for this exact path. */
function claims(layer: ResourceLayer, path: string): boolean {
  return prefixesOf(layer).some((prefix) => isWithin(prefix, path));
}

/** True when the layer holds anything inside the queried subtree, or is inside it. */
function intersects(layer: ResourceLayer, subtree: string): boolean {
  return prefixesOf(layer).some(
    (prefix) => isWithin(prefix, subtree) || isWithin(subtree, prefix),
  );
}

/**
 * True when a path from this layer belongs in merged output — either the
 * layer claims it, or it's a directory on the way down to something the
 * layer claims. Without the second case, a stratum scoped to `/a/b` would
 * have `/a` filtered out of `ls /` and its own grant would be unreachable.
 */
function visible(layer: ResourceLayer, path: string, kind: "file" | "directory"): boolean {
  if (claims(layer, path)) return true;
  if (kind !== "directory") return false;
  return prefixesOf(layer).some((prefix) => isWithin(path, prefix));
}

/**
 * Merges several `ResourceFsAdapter`s into one filesystem.
 *
 * The shape that motivates it: a shared corpus the agent reads but must not
 * change, plus a private store it owns outright, presented as one tree it
 * navigates with the ordinary `ls` / `read` / `grep` / `glob` verbs.
 *
 * **Two ways to arrange a stack, one rule.** Layer order is precedence, and
 * `paths` scopes a layer to a subtree:
 *
 * ```ts
 * // Mounted: disjoint namespaces, nothing overlaps.
 * layerResources([
 *   { name: "handbook", adapter: shared,  access: "read",  paths: ["/handbook"] },
 *   { name: "notes",    adapter: private, access: "write" },
 * ]);
 *
 * // Union: both span the whole tree, private shadows shared on a collision.
 * layerResources([
 *   { name: "notes",    adapter: private, access: "write" },
 *   { name: "handbook", adapter: shared,  access: "read" },
 * ]);
 * ```
 *
 * Reads of a single path try the claiming strata in order and take the first
 * hit. Multi-path reads (`list`, `grep`, `glob`, `searchSemantic`,
 * `linksFor`) fan out to every stratum intersecting the queried subtree,
 * drop anything outside what that stratum claims, and merge with earlier
 * layers winning.
 *
 * **Writes route to whichever stratum already holds the path**, falling back
 * to the prefix owner when the path is new. That ordering is what makes the
 * refusals legible: `remove("/handbook/pay.md")` reports that the file
 * belongs to a read-only stratum, rather than the "not found" you'd get from
 * routing the delete into the private store first.
 *
 * There is no copy-on-write: editing a shared file is refused, not forked
 * into a private shadow.
 */
export function layerResources(layers: ResourceLayer[]): LayeredResourceFsAdapter {
  const { all, writable } = resolveLayers(layers, "layerResources");
  const searchable = all.filter((l) => l.adapter.supportsSemanticSearch && l.adapter.searchSemantic);

  function claiming(path: string): ResourceLayer[] {
    return all.filter((l) => claims(l, path));
  }

  /** First stratum that actually holds the path. */
  async function holder(path: string): Promise<ResourceLayer | null> {
    for (const layer of claiming(path)) {
      if (await layer.adapter.exists(path)) return layer;
    }
    return null;
  }

  /**
   * The stratum a mutation lands in: whoever holds the path today, else
   * whoever claims the prefix (a create).
   */
  async function ownerForWrite(path: string): Promise<ResourceLayer> {
    const existing = await holder(path);
    if (existing) return existing;
    const claimant = claiming(path)[0];
    if (!claimant) {
      throw new MemoryLayerError(
        "layer_config",
        `No layer serves "${normalisePath(path)}". Scoped layers cover ${all
          .map((l) => `"${l.name}" (${prefixesOf(l).join(", ")})`)
          .join("; ")}.`,
      );
    }
    return claimant;
  }

  async function requireWritable(path: string, operation: string): Promise<ResourceLayer> {
    const owner = await ownerForWrite(path);
    if (owner.access !== "write") {
      refuseWrite(owner.name, `"${normalisePath(path)}"`, operation);
    }
    return owner;
  }

  /** Fans a subtree-scoped read out to the strata that intersect it. */
  function fanOut<T>(
    subtree: string,
    call: (layer: ResourceLayer) => Promise<T[]>,
  ): Promise<T[][]> {
    return Promise.all(
      all.map((layer) => (intersects(layer, subtree) ? call(layer) : Promise.resolve([]))),
    );
  }

  const adapter: LayeredResourceFsAdapter = {
    identifier: `layered(${all.map((l) => l.adapter.identifier).join("+")})`,
    schema: all[0]!.adapter.schema,
    supportsSemanticSearch: searchable.length > 0,
    layers: all,

    async layerOf(path) {
      return (await holder(path))?.name ?? null;
    },

    // ─── Read ─────────────────────────────────────────────────────────────

    async list(path: string, opts?: { recursive?: boolean; limit?: number }) {
      // A directory that exists in one stratum usually doesn't in the
      // others, and adapters signal that by throwing. So a per-layer failure
      // is only fatal when *every* stratum fails — then the path is
      // genuinely bad and the first error is the honest answer.
      const asked = all.filter((layer) => intersects(layer, path));
      if (asked.length === 0) {
        throw new MemoryLayerError(
          "layer_config",
          `No layer serves "${normalisePath(path)}".`,
        );
      }
      const settled = await Promise.all(
        asked.map(async (layer): Promise<DirectoryEntry[] | { error: unknown }> => {
          try {
            const entries = await layer.adapter.list(path, opts);
            return entries.filter((e) => visible(layer, e.path, e.kind));
          } catch (error) {
            return { error };
          }
        }),
      );
      const groups = settled.filter((r): r is DirectoryEntry[] => Array.isArray(r));
      if (groups.length === 0) {
        // Every stratum that could have served this path failed, so the path
        // is genuinely bad — the first adapter's own error is the honest
        // answer, rather than an empty listing that reads as "exists, empty".
        const failure = settled.find((r): r is { error: unknown } => !Array.isArray(r));
        throw failure!.error;
      }
      const merged = mergeUnique<DirectoryEntry>(groups, (e) => e.path);
      return opts?.limit === undefined ? merged : merged.slice(0, opts.limit);
    },

    async read(path, opts) {
      const owner = await holder(path);
      if (!owner) return firstClaimant(path).adapter.read(path, opts);
      return owner.adapter.read(path, opts);
    },

    async stat(path) {
      const owner = await holder(path);
      return owner ? owner.adapter.stat(path) : null;
    },

    async exists(path) {
      return (await holder(path)) !== null;
    },

    // ─── Search ───────────────────────────────────────────────────────────

    async grep(spec: GrepSpec): Promise<GrepMatch[]> {
      const scope = spec.path ?? "/";
      const groups = await fanOut(scope, async (layer) => {
        const matches = await layer.adapter.grep(spec);
        return matches.filter((m) => claims(layer, m.path));
      });
      // Matches are (path, line) pairs — a file legitimately contributes many.
      const merged = mergeUnique<GrepMatch>(groups, (m) => `${m.path}:${m.line}`);
      return spec.limit === undefined ? merged : merged.slice(0, spec.limit);
    },

    async glob(pattern: string, opts?: { path?: string; limit?: number }) {
      const scope = opts?.path ?? "/";
      const groups = await fanOut(scope, async (layer) => {
        const paths = await layer.adapter.glob(pattern, opts);
        return paths.filter((p) => claims(layer, p));
      });
      const merged = mergeUnique<string>(groups, (p) => p);
      return opts?.limit === undefined ? merged : merged.slice(0, opts.limit);
    },

    // ─── Write ────────────────────────────────────────────────────────────

    async write(
      path: string,
      body: ResourceBody,
      metadata: ResourceMetadata,
      provenance: Provenance,
    ) {
      const owner = await requireWritable(path, "writing to it");
      return owner.adapter.write(path, body, metadata, provenance);
    },

    async edit(path, oldStr, newStr, provenance) {
      const owner = await requireWritable(path, "editing it");
      return owner.adapter.edit(path, oldStr, newStr, provenance);
    },

    async mkdir(path, provenance) {
      const owner = await requireWritable(path, "creating it");
      return owner.adapter.mkdir(path, provenance);
    },

    async move(fromPath, toPath, provenance) {
      const from = await requireWritable(fromPath, "moving it");
      const to = await requireWritable(toPath, "moving into it");
      if (from.name !== to.name) {
        // Relocating across strata would mean copy-then-delete, and the
        // delete half lands in a stratum that refuses it. Better a clear
        // refusal than a half-completed move.
        throw new MemoryLayerError(
          "cross_layer_unsupported",
          `Moving "${normalisePath(fromPath)}" to "${normalisePath(toPath)}" would cross layers ("${from.name}" → "${to.name}"). Read the file and write it to the destination instead.`,
          from.name,
        );
      }
      return from.adapter.move(fromPath, toPath, provenance);
    },

    async remove(path, recursive, provenance) {
      const owner = await requireWritable(path, "removing it");
      if (recursive) {
        // A recursive delete in the writable stratum must not be reported as
        // having cleared paths another stratum still serves.
        const trapped = all.find(
          (l) => l.access !== "write" && intersects(l, normalisePath(path)),
        );
        if (trapped) {
          refuseWrite(
            trapped.name,
            `A recursive remove of "${normalisePath(path)}"`,
            "it would reach paths that stratum serves, so the delete",
          );
        }
      }
      return owner.adapter.remove(path, recursive, provenance);
    },

    async setMetadata(path, patch, provenance) {
      const owner = await requireWritable(path, "setting metadata on it");
      return owner.adapter.setMetadata(path, patch, provenance);
    },

    // ─── Reverse linking and bulk rewrite ─────────────────────────────────

    async linksFor(targetKind, targetId) {
      const groups = await Promise.all(
        all.map(async (layer) => {
          const paths = await layer.adapter.linksFor(targetKind, targetId);
          return paths.filter((p) => claims(layer, p));
        }),
      );
      return mergeUnique<string>(groups, (p) => p);
    },

    async replaceLinkTarget(fromKind, fromId, toId, provenance) {
      // Reconciliation rewrites file metadata in place, so it can only touch
      // the writable stratum. A shared corpus is reconciled by whoever owns
      // it, against its own unlayered adapter.
      return writable.adapter.replaceLinkTarget(fromKind, fromId, toId, provenance);
    },

    // ─── Embedding lifecycle ──────────────────────────────────────────────

    async findFilesNeedingEmbedding(opts?: { limit?: number }) {
      const groups = await Promise.all(
        all.map(async (layer) => {
          if (!layer.adapter.findFilesNeedingEmbedding) return [];
          const files = await layer.adapter.findFilesNeedingEmbedding(opts);
          return files.filter((f) => claims(layer, f.path));
        }),
      );
      const merged = mergeUnique(groups, (f) => f.path);
      return opts?.limit === undefined ? merged : merged.slice(0, opts.limit);
    },

    async setEmbedding(path: string, vector: number[]) {
      // Indexing is the host's business, not the agent's, so it is allowed
      // against a read-only stratum.
      const owner = await holder(path);
      if (!owner?.adapter.setEmbedding) {
        throw new MemoryLayerError(
          "layer_read_only",
          `No layer holding "${normalisePath(path)}" supports the embedding lifecycle.`,
        );
      }
      return owner.adapter.setEmbedding(path, vector);
    },
  };

  /** Used only to produce the underlying adapter's own not-found error. */
  function firstClaimant(path: string): ResourceLayer {
    const claimant = claiming(path)[0];
    if (!claimant) {
      throw new MemoryLayerError(
        "layer_config",
        `No layer serves "${normalisePath(path)}".`,
      );
    }
    return claimant;
  }

  if (searchable.length > 0) {
    adapter.searchSemantic = async (
      query: string,
      opts?: ResourceSemanticSearchOpts,
    ): Promise<SemanticMatch[]> => {
      const scope = opts?.path ?? "/";
      const groups = await Promise.all(
        searchable.map(async (layer) => {
          if (!intersects(layer, scope)) return [];
          const matches = await layer.adapter.searchSemantic!(query, opts);
          return matches.filter((m) => claims(layer, m.path));
        }),
      );
      const merged = mergeUnique<SemanticMatch>(groups, (m) => m.path);
      // Best-effort interleave: scores are only comparable when the strata
      // rank alike, which two independently-built indexes generally don't.
      merged.sort((a, b) => b.score - a.score);
      return opts?.limit === undefined ? merged : merged.slice(0, opts.limit);
    };
  }

  return adapter;
}
