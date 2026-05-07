import type { Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type {
  DirectoryEntry,
  GrepMatch,
  GrepSpec,
  ResourceBody,
  ResourceFile,
  ResourceMetadata,
  ResourceSemanticSearchOpts,
  ResourceStat,
  SemanticMatch,
} from "./types";

/**
 * Storage-agnostic contract for the resources subsystem.
 *
 * **POSIX-style virtual filesystem.** The agent navigates with the same
 * vocabulary it uses on a real codebase: `ls`, `read`, `grep`, `glob`,
 * `edit`. Holds research artifacts, transcripts, link collections, and
 * agent-generated notes — text content that doesn't fit the entity graph
 * or the episodic timeline.
 *
 * **Multiple actors.** Both the curator and the user can write directly
 * via this adapter. Provenance disambiguates them; the agent reading the
 * tree doesn't see the difference.
 *
 * **Text-only.** Binary resources are out of scope. Consumers wanting
 * binary storage should use a separate object store and link to it from a
 * text resource.
 *
 * **Embedding lifecycle.** `write` and `edit` mark the file
 * `embeddingStatus: "stale"` (or `"missing"` on initial create). A separate
 * process picks up files via `findFilesNeedingEmbedding`, computes
 * embeddings, and writes them via `setEmbedding`. Files with non-fresh
 * embeddings are still grep-able and listable; they're invisible to
 * `searchSemantic` until embedded.
 */
export interface ResourceFsAdapter {
  identifier: string;
  schema: MemorySchema;
  supportsSemanticSearch: boolean;

  // ─── Read ─────────────────────────────────────────────────────────────

  list(
    path: string,
    opts?: { recursive?: boolean; limit?: number },
  ): Promise<DirectoryEntry[]>;

  /** Reads a line range. Default `[1, 50]`. Pass `[start, -1]` for start-to-EOF. */
  read(
    path: string,
    opts?: { range?: [number, number] },
  ): Promise<ResourceFile>;

  stat(path: string): Promise<ResourceStat | null>;

  exists(path: string): Promise<boolean>;

  // ─── Search ───────────────────────────────────────────────────────────

  grep(spec: GrepSpec): Promise<GrepMatch[]>;

  glob(
    pattern: string,
    opts?: { path?: string; limit?: number },
  ): Promise<string[]>;

  searchSemantic?(
    query: string,
    opts?: ResourceSemanticSearchOpts,
  ): Promise<SemanticMatch[]>;

  // ─── Write ────────────────────────────────────────────────────────────

  write(
    path: string,
    body: ResourceBody,
    metadata: ResourceMetadata,
    provenance: Provenance,
  ): Promise<void>;

  /** Replace a unique substring within a text or markdown body. Throws if `oldStr` matches zero or more than once. */
  edit(
    path: string,
    oldStr: string,
    newStr: string,
    provenance: Provenance,
  ): Promise<void>;

  mkdir(path: string, provenance: Provenance): Promise<void>;

  move(fromPath: string, toPath: string, provenance: Provenance): Promise<void>;

  remove(
    path: string,
    recursive: boolean,
    provenance: Provenance,
  ): Promise<void>;

  setMetadata(
    path: string,
    patch: Partial<ResourceMetadata>,
    provenance: Provenance,
  ): Promise<void>;

  // ─── Reverse linking and bulk rewrite ─────────────────────────────────

  /** Find resources whose `metadata.links` target the given entity / episode / resource. */
  linksFor(
    targetKind: "entity" | "episode" | "resource",
    targetId: string,
  ): Promise<string[]>;

  /** Bulk reference rewrite — used by orchestrators after entity merge or resource move. */
  replaceLinkTarget(
    fromKind: "entity" | "episode" | "resource",
    fromId: string,
    toId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }>;

  // ─── Embedding lifecycle (only when supportsSemanticSearch is true) ───

  findFilesNeedingEmbedding?(
    opts?: { limit?: number },
  ): Promise<Array<{ path: string; content: string }>>;

  setEmbedding?(path: string, vector: number[]): Promise<void>;
}
