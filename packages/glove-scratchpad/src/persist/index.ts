/**
 * Storable + resumable scratchpads — the glove way.
 *
 * A scratchpad is "computation as a value" (§10): `snapshot()` serialises the
 * whole store to bytes, and a backend can be reconstructed from them. This module
 * turns that into the same BYO-adapter pattern glove uses everywhere — a
 * {@link ScratchpadStore} you implement over your DB / KV / object store, plus
 * helpers to persist, restore, and (event-driven) auto-persist.
 *
 * The references an agent knows live in its message history (the stubs in tool
 * results, persisted by glove's `StoreAdapter`). Persist the scratchpad snapshot
 * under the same key (e.g. the session id) and a resumed conversation finds both
 * its messages AND the data those references resolve to.
 *
 * ```ts
 * // first run
 * const sp = await Scratchpad.create(await MemoryBackend.create());
 * const stopPersist = autoPersistScratchpad(sp, { store, key: sessionId });
 *
 * // …later, resuming the same session
 * const sp = (await restoreScratchpad({ store, key: sessionId }))
 *   ?? (await Scratchpad.create(await MemoryBackend.create()));
 * ```
 */
import type { ScratchpadBackend } from "../core/types";
import type { ScratchpadEvent } from "../core/events";
import { Scratchpad } from "../core/scratchpad";
import { MemoryBackend } from "../backends/memory";

/**
 * Where a scratchpad snapshot is durably stored. Three methods — implement over
 * Postgres, S3, Redis, IndexedDB, the filesystem (see `glove-scratchpad/persist-fs`),
 * whatever your stack uses. Mirrors the minimalism of glove-mcp's `OAuthStore`.
 */
export interface ScratchpadStore {
  save(key: string, bytes: Uint8Array): Promise<void>;
  /** Return the bytes saved under `key`, or null if nothing is stored. */
  load(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** In-process reference store — loses data on restart. For tests / single-process dev. */
export class MemoryScratchpadStore implements ScratchpadStore {
  private map = new Map<string, Uint8Array>();
  async save(key: string, bytes: Uint8Array): Promise<void> {
    this.map.set(key, bytes.slice());
  }
  async load(key: string): Promise<Uint8Array | null> {
    const v = this.map.get(key);
    return v ? v.slice() : null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  /** Keys currently held — handy for tests / introspection. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Snapshot the scratchpad and write it to `store` under `key`. */
export async function persistScratchpad(
  sp: Scratchpad,
  store: ScratchpadStore,
  key: string,
): Promise<void> {
  const bytes = await sp.snapshot();
  await store.save(key, bytes);
}

export interface RestoreScratchpadOptions {
  store: ScratchpadStore;
  key: string;
  /**
   * Build a backend from the saved snapshot. Defaults to
   * `MemoryBackend.create({ load })`. Pass this when you snapshotted a different
   * backend (e.g. `(load) => PgliteBackend.create({ load })`).
   */
  backend?: (snapshot: Uint8Array) => Promise<ScratchpadBackend>;
}

/**
 * Load a saved snapshot and rebuild a {@link Scratchpad}, or `null` if nothing is
 * stored under `key` (so the caller can fall back to a fresh scratchpad).
 */
export async function restoreScratchpad(
  opts: RestoreScratchpadOptions,
): Promise<Scratchpad | null> {
  const bytes = await opts.store.load(opts.key);
  if (!bytes) return null;
  const backend = opts.backend
    ? await opts.backend(bytes)
    : await MemoryBackend.create({ load: bytes });
  return Scratchpad.create(backend);
}

export interface AutoPersistOptions {
  store: ScratchpadStore;
  key: string;
  /** Coalesce a burst of mutations into one save after this many ms of quiet. Default 250. */
  debounceMs?: number;
  /** Called after each successful save. */
  onPersist?: (info: { key: string; bytes: number }) => void;
  /** Called if a save throws (the loop keeps running). */
  onError?: (err: unknown) => void;
}

/**
 * Subscribe to the scratchpad and debounce-save after each MUTATION — ingest, a
 * stored query (`CREATE TABLE AS`), or drop. Read-only ops (plain query,
 * materialize) and the snapshot itself never trigger a save, so there's no loop.
 *
 * Returns a stop function that unsubscribes and flushes any pending save — call
 * it on conversation end. The scratchpad then survives a restart with no
 * explicit checkpoint calls; resume with {@link restoreScratchpad}.
 */
export function autoPersistScratchpad(
  sp: Scratchpad,
  opts: AutoPersistOptions,
): () => Promise<void> {
  const debounceMs = opts.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let inFlight: Promise<void> = Promise.resolve();

  const flush = async (): Promise<void> => {
    if (!pending) return;
    pending = false;
    try {
      const bytes = await sp.snapshot();
      await opts.store.save(opts.key, bytes);
      opts.onPersist?.({ key: opts.key, bytes: bytes.byteLength });
    } catch (err) {
      opts.onError?.(err);
    }
  };

  const off = sp.subscribe({
    record(ev: ScratchpadEvent) {
      const mutates =
        ev.type === "ingest" ||
        ev.type === "drop" ||
        (ev.type === "query" && ev.stored != null);
      if (!mutates) return;
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        inFlight = flush();
      }, debounceMs);
    },
  });

  return async () => {
    off();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await inFlight; // let any in-flight save finish
    await flush(); // and write a final pending mutation
  };
}
