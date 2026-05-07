import type { Link, Provenance } from "../core/provenance";

export type ResourceBody =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
  | { type: "url"; url: string; cachedText?: string };

export interface ResourceMetadata {
  /** Short description shown in lazy-browse listings. */
  summary?: string;
  /** Cross-cutting labels. */
  tags: string[];
  /** Cross-references to entity nodes, episodes, or other resources. */
  links: Link[];
  /** Free-form consumer-defined fields. */
  [key: string]: unknown;
}

export interface ResourceFile {
  path: string;
  body: ResourceBody;
  metadata: ResourceMetadata;
  embeddingStatus: "missing" | "fresh" | "stale";
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  // file-only fields, populated for kind === "file"
  contentType?: "text" | "markdown" | "url";
  size?: number;
  summary?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface ResourceStat {
  path: string;
  kind: "file" | "directory";
  size?: number;
  contentType?: "text" | "markdown" | "url";
  metadata?: ResourceMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface GrepSpec {
  query: string;
  /** Treat query as a regex when true. Default false (literal substring). */
  regex?: boolean;
  /** Case-sensitive when true. Default false. */
  caseSensitive?: boolean;
  /** Restrict to a subtree. Default "/". */
  path?: string;
  /** Restrict to certain content types. */
  contentTypes?: Array<"text" | "markdown" | "url">;
  /** Lines of context around each match. Default 2. */
  contextLines?: number;
  limit?: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
  context?: { before: string[]; after: string[] };
}

export interface SemanticMatch {
  path: string;
  summary?: string;
  score: number;
  distance: number;
}

export interface ResourceSemanticSearchOpts {
  limit?: number;
  /** Restrict to a subtree. */
  path?: string;
  /** Restrict to certain content types. */
  contentTypes?: Array<"text" | "markdown" | "url">;
  /** 0 = pure semantic, 1 = pure recency. Default 0 (no recency bias by default for resources). */
  recencyWeight?: number;
}

/** Returns the textual content searchable by grep / semantic, or null when there's nothing useful (e.g. URL body without cachedText). */
export function searchableText(body: ResourceBody): string | null {
  if (body.type === "text" || body.type === "markdown") return body.text;
  if (body.type === "url") return body.cachedText ?? null;
  return null;
}

/** Returns the body's serialisable size in bytes (length of underlying string), or undefined when none applies. */
export function bodySize(body: ResourceBody): number | undefined {
  if (body.type === "text" || body.type === "markdown") return body.text.length;
  if (body.type === "url") return body.cachedText?.length ?? body.url.length;
  return undefined;
}
