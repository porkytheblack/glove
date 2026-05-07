import { z } from "zod";
import { LinkSchema, type Link } from "../core/provenance";
import type { Provenance } from "../core/provenance";

/**
 * A single entry of user-configured ambient context. Sections are free-form
 * strings — context is genuinely user-shaped and varies per consumer; trying
 * to enforce a vocabulary schema-side defeats the point.
 *
 * Pinned entries are auto-injected into the system prompt at every turn.
 * Non-pinned entries are read on demand via the `glove_context_get` tool.
 */
export interface ContextEntry {
  id: string;
  /** Free-form section name — `"identity"`, `"preferences"`, `"glossary"`, `"current_task"`, etc. */
  section: string;
  /** Optional title within the section. */
  title?: string;
  /** Markdown body. */
  content: string;
  /** True = always injected at turn start. False = read on demand via tool. */
  pinned: boolean;
  /** Optional ISO 8601 expiry. The adapter filters expired entries from `render` and `list`. */
  expiresAt?: string;
  /** Optional cross-references. */
  links?: Link[];
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

/** Input shape for `set` — same as `ContextEntry` minus the adapter-managed fields. */
export type ContextEntryInput = Omit<
  ContextEntry,
  "id" | "createdAt" | "updatedAt" | "provenance"
>;

export const ContextEntryInputSchema = z.object({
  section: z.string().min(1),
  title: z.string().optional(),
  content: z.string(),
  pinned: z.boolean(),
  expiresAt: z.string().optional(),
  links: z.array(LinkSchema).optional(),
});

export const ContextEntryPatchSchema = z.object({
  section: z.string().min(1).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.string().optional(),
  links: z.array(LinkSchema).optional(),
});

export type ContextEntryPatch = z.infer<typeof ContextEntryPatchSchema>;

export interface ContextRenderOpts {
  /** When true, include unpinned entries in the rendered output. Default false. */
  includeUnpinned?: boolean;
  /** Restrict to the named sections. Default: all sections. */
  sections?: string[];
}
