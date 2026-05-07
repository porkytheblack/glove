import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  ContextEntry,
  ContextEntryInput,
  ContextEntryPatch,
  ContextRenderOpts,
} from "./types";

/**
 * Storage-agnostic contract for user-configured ambient context.
 *
 * **Different shape from the other three subsystems.** Not curator-extracted
 * — users write context directly via whatever UI / form / API the consumer
 * builds. Not lazily browsed — pinned entries are auto-injected into the
 * system prompt at every turn. Not reader/curator-split — one registration
 * (`useContext`) gives the conversational agent both read and write tools.
 *
 * **User-side write path is consumer territory.** This adapter exposes
 * `set` / `update` / `unset` / `setSection` / `unsetSection` / `list`;
 * consumers wire those into whatever UI or service makes sense.
 */
export interface ContextAdapter {
  identifier: string;
  schema: MemorySchema;

  // ─── Read ─────────────────────────────────────────────────────────────

  list(section?: string): Promise<ContextEntry[]>;
  get(id: string): Promise<ContextEntry | null>;

  /**
   * Render the markdown block to inject into the system prompt. Pinned
   * entries by default. Expired entries are filtered out silently.
   */
  render(opts?: ContextRenderOpts): Promise<string>;

  // ─── Write ────────────────────────────────────────────────────────────

  set(entry: ContextEntryInput, provenance: Provenance): Promise<{ id: string }>;

  update(
    id: string,
    patch: ContextEntryPatch,
    provenance: Provenance,
  ): Promise<void>;

  unset(id: string, provenance: Provenance): Promise<void>;

  /** Bulk replace all entries in a section. Common "user updated their preferences pane" flow. */
  setSection(
    section: string,
    entries: Array<Omit<ContextEntryInput, "section">>,
    provenance: Provenance,
  ): Promise<void>;

  unsetSection(section: string, provenance: Provenance): Promise<void>;
}
