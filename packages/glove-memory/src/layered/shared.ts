import { MemoryLayerError } from "../core/errors";

/**
 * What a stratum may be used for.
 *
 * - `"read"` — a shared corpus. Merged into every read; every write into it
 *   is refused.
 * - `"write"` — the private stratum. Every write lands here. Exactly one
 *   layer in a stack carries it.
 */
export type LayerAccess = "read" | "write";

/**
 * One stratum in a layered memory subsystem.
 *
 * `name` is the stratum's identity in error messages ("`/handbook/pay.md` is
 * owned by the read-only layer \"handbook\""), so make it something a reader
 * of a log will recognise.
 */
export interface MemoryLayer<A> {
  name: string;
  adapter: A;
  access: LayerAccess;
}

export interface ResolvedLayers<A> {
  all: Array<MemoryLayer<A>>;
  /** The single `access: "write"` layer. Every write routes here. */
  writable: MemoryLayer<A>;
}

/**
 * Validates a layer stack and picks out the writable stratum.
 *
 * Exactly one writable layer is required. Zero means nothing could ever be
 * written and every write tool would be a trap; two means write routing is
 * ambiguous, and quietly picking one would send the agent's notes into a
 * store the consumer didn't intend. Both are configuration bugs worth
 * failing at construction rather than at the first write.
 */
export function resolveLayers<A>(
  layers: Array<MemoryLayer<A>>,
  subsystem: string,
): ResolvedLayers<A> {
  if (layers.length === 0) {
    throw new MemoryLayerError("layer_config", `${subsystem}: at least one layer is required.`);
  }
  const names = new Set<string>();
  for (const layer of layers) {
    if (names.has(layer.name)) {
      throw new MemoryLayerError(
        "layer_config",
        `${subsystem}: duplicate layer name "${layer.name}". Layer names appear in error messages and must be distinguishable.`,
        layer.name,
      );
    }
    names.add(layer.name);
  }
  const writable = layers.filter((l) => l.access === "write");
  if (writable.length === 0) {
    throw new MemoryLayerError(
      "layer_config",
      `${subsystem}: no layer has access "write". A layered stack needs exactly one writable stratum for writes to land in.`,
    );
  }
  if (writable.length > 1) {
    throw new MemoryLayerError(
      "layer_config",
      `${subsystem}: ${writable.length} layers have access "write" (${writable
        .map((l) => `"${l.name}"`)
        .join(", ")}). Exactly one is required, otherwise write routing is ambiguous.`,
    );
  }
  return { all: layers, writable: writable[0]! };
}

/** Throws the standard "that stratum is read-only" refusal. */
export function refuseWrite(
  layerName: string,
  what: string,
  operation: string,
): never {
  throw new MemoryLayerError(
    "layer_read_only",
    `${what} belongs to the read-only layer "${layerName}", so ${operation} is refused. Shared strata are immutable through the layered view.`,
    layerName,
  );
}

/**
 * Concatenates per-layer results, dropping anything already contributed by an
 * earlier layer. Earlier layers win, which is what makes layer order the
 * shadowing rule.
 */
export function mergeUnique<T>(groups: T[][], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Applies `offset` / `limit` to an already-merged list.
 *
 * A per-layer `limit` can't be pushed down as-is when results are merged:
 * asking each of two layers for 10 and taking the first 10 of 20 is correct,
 * but asking each for `limit` and *skipping* `offset` per layer is not — the
 * rows an earlier layer skipped aren't the rows the merged view skips. So
 * layers are queried with `limit + offset` and no offset, and the window is
 * applied here.
 */
export function windowed<T>(items: T[], opts?: { limit?: number; offset?: number }): T[] {
  const offset = opts?.offset ?? 0;
  if (!offset && opts?.limit === undefined) return items;
  const limit = opts?.limit ?? items.length;
  return items.slice(offset, offset + limit);
}

/** The per-layer fetch size that makes a merged `offset`/`limit` window correct. */
export function pushDownLimit(opts?: { limit?: number; offset?: number }): number | undefined {
  if (opts?.limit === undefined) return undefined;
  return opts.limit + (opts.offset ?? 0);
}
