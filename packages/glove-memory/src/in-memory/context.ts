import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type { ContextAdapter } from "../context/adapter";
import type {
  ContextEntry,
  ContextEntryInput,
  ContextEntryPatch,
  ContextRenderOpts,
} from "../context/types";
import { isExpired, renderEntries } from "../context/render";
import {
  MemoryError,
  MemoryNotFoundError,
  MemoryWriteError,
} from "../core/errors";

/**
 * Reference in-process context adapter. Stores entries in a Map keyed by id.
 */
export class InMemoryContextAdapter implements ContextAdapter {
  identifier: string;
  schema: MemorySchema;

  private readonly entries = new Map<string, ContextEntry>();
  private nextId = 1;

  constructor(opts: { schema: MemorySchema; identifier?: string }) {
    this.schema = opts.schema;
    this.identifier = opts.identifier ?? `in-memory-context-${Date.now()}`;
  }

  // ─── Read ───────────────────────────────────────────────────────────────

  async list(section?: string): Promise<ContextEntry[]> {
    const out: ContextEntry[] = [];
    for (const entry of this.entries.values()) {
      if (isExpired(entry)) continue;
      if (section && entry.section !== section) continue;
      out.push(cloneEntry(entry));
    }
    return out.sort((a, b) => a.section.localeCompare(b.section) || a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<ContextEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (isExpired(entry)) return null;
    return cloneEntry(entry);
  }

  async render(opts: ContextRenderOpts = {}): Promise<string> {
    const { includeUnpinned = false, sections } = opts;
    const sectionFilter = sections ? new Set(sections) : null;
    const live: ContextEntry[] = [];
    for (const entry of this.entries.values()) {
      if (isExpired(entry)) continue;
      if (!includeUnpinned && !entry.pinned) continue;
      if (sectionFilter && !sectionFilter.has(entry.section)) continue;
      live.push(entry);
    }
    live.sort(
      (a, b) =>
        a.section.localeCompare(b.section) || a.createdAt.localeCompare(b.createdAt),
    );
    return renderEntries(live);
  }

  // ─── Write ──────────────────────────────────────────────────────────────

  async set(entry: ContextEntryInput, provenance: Provenance): Promise<{ id: string }> {
    requireProvenance(provenance);
    if (!entry.section || entry.section.length === 0) {
      throw new MemoryWriteError("validation_failed", "Context entry must include a non-empty section.");
    }
    const id = this.genId();
    const now = new Date().toISOString();
    this.entries.set(id, {
      id,
      section: entry.section,
      title: entry.title,
      content: entry.content,
      pinned: entry.pinned,
      expiresAt: entry.expiresAt,
      links: entry.links ? [...entry.links] : undefined,
      createdAt: now,
      updatedAt: now,
      provenance: [provenance],
    });
    return { id };
  }

  async update(
    id: string,
    patch: ContextEntryPatch,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const entry = this.entries.get(id);
    if (!entry) throw new MemoryNotFoundError(`No context entry with id "${id}".`);
    if (patch.section !== undefined) entry.section = patch.section;
    if (patch.title !== undefined) entry.title = patch.title;
    if (patch.content !== undefined) entry.content = patch.content;
    if (patch.pinned !== undefined) entry.pinned = patch.pinned;
    if (patch.expiresAt !== undefined) entry.expiresAt = patch.expiresAt;
    if (patch.links !== undefined) entry.links = [...patch.links];
    entry.updatedAt = new Date().toISOString();
    entry.provenance.push(provenance);
  }

  async unset(id: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    if (!this.entries.has(id)) {
      throw new MemoryNotFoundError(`No context entry with id "${id}".`);
    }
    this.entries.delete(id);
  }

  async setSection(
    section: string,
    entries: Array<Omit<ContextEntryInput, "section">>,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    if (!section || section.length === 0) {
      throw new MemoryWriteError("validation_failed", "setSection requires a non-empty section name.");
    }
    // Wipe existing entries in the section.
    for (const [id, entry] of [...this.entries.entries()]) {
      if (entry.section === section) this.entries.delete(id);
    }
    for (const e of entries) {
      await this.set({ ...e, section }, provenance);
    }
  }

  async unsetSection(section: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    let removed = 0;
    for (const [id, entry] of [...this.entries.entries()]) {
      if (entry.section === section) {
        this.entries.delete(id);
        removed++;
      }
    }
    if (removed === 0) {
      throw new MemoryNotFoundError(`No context entries in section "${section}".`);
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private genId(): string {
    const id = `ctx_${this.nextId.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.nextId++;
    return id;
  }
}

function cloneEntry(e: ContextEntry): ContextEntry {
  return {
    ...e,
    links: e.links ? [...e.links] : undefined,
    provenance: [...e.provenance],
  };
}

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (!p || typeof p !== "object" || typeof p.source !== "string" || typeof p.actor !== "string" || typeof p.timestamp !== "string") {
    throw new MemoryWriteError("provenance_required", "A provenance record is required on every write.");
  }
}

// Re-export so adapters subclassing this can throw the canonical errors.
export { MemoryError };
