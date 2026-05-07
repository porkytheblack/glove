import {
  MemoryNotFoundError,
  MemoryWriteError,
  ResourceFsError,
} from "../core/errors";
import type { EmbeddingAdapter } from "../core/embedding";
import type { Link, Provenance } from "../core/provenance";
import type { MemorySchema } from "../core/schema";
import type { ResourceFsAdapter } from "../resources/adapter";
import {
  bodySize,
  searchableText,
  type DirectoryEntry,
  type GrepMatch,
  type GrepSpec,
  type ResourceBody,
  type ResourceFile,
  type ResourceMetadata,
  type ResourceSemanticSearchOpts,
  type ResourceStat,
  type SemanticMatch,
} from "../resources/types";
import {
  basename,
  isWithin,
  matchGlob,
  normalisePath,
  parentDir,
} from "../resources/paths";

interface InMemoryResourcesOpts {
  schema: MemorySchema;
  identifier?: string;
  /** Optional embedder. When provided, semantic search is enabled. */
  embedder?: EmbeddingAdapter;
}

/**
 * Reference in-process adapter for the resources subsystem. Stores files
 * in a Map keyed by absolute path; tracks empty directories separately so
 * `mkdir` works without files. Linear scans drive `list`, `grep`, `glob`,
 * and semantic search.
 */
export class InMemoryResourcesAdapter implements ResourceFsAdapter {
  identifier: string;
  schema: MemorySchema;
  supportsSemanticSearch: boolean;

  private readonly files = new Map<string, ResourceFile>();
  private readonly emptyDirs = new Set<string>();
  private readonly embeddings = new Map<string, number[]>();
  private readonly embedder?: EmbeddingAdapter;

  constructor(opts: InMemoryResourcesOpts) {
    this.schema = opts.schema;
    this.identifier = opts.identifier ?? `in-memory-resources-${Date.now()}`;
    this.embedder = opts.embedder;
    this.supportsSemanticSearch = Boolean(opts.embedder);
  }

  // ─── Read ───────────────────────────────────────────────────────────────

  async list(
    path: string,
    opts: { recursive?: boolean; limit?: number } = {},
  ): Promise<DirectoryEntry[]> {
    const root = normalisePath(path);
    if (!(await this.dirExists(root))) {
      // If a file lives at this path, the request is well-formed but the
      // path isn't a directory; surface that distinction to callers.
      if (this.files.has(root)) {
        throw new ResourceFsError("not_a_directory", `Path is a file, not a directory: "${root}".`);
      }
      throw new ResourceFsError("path_not_found", `Directory not found: "${root}".`);
    }
    const entries = new Map<string, DirectoryEntry>();
    const recursive = opts.recursive ?? false;

    for (const file of this.files.values()) {
      if (!isWithin(root, file.path)) continue;
      if (file.path === root) continue;
      if (recursive) {
        entries.set(file.path, fileEntry(file));
      } else {
        // Direct child only.
        const pd = parentDir(file.path);
        if (pd === root) {
          entries.set(file.path, fileEntry(file));
        } else if (isWithin(root, pd)) {
          // Implicit subdirectory of `root`. Add it as a directory entry.
          const childDirSegment = pd.slice(root === "/" ? 1 : root.length + 1).split("/")[0]!;
          const dirPath = root === "/" ? `/${childDirSegment}` : `${root}/${childDirSegment}`;
          if (!entries.has(dirPath)) {
            entries.set(dirPath, dirEntry(dirPath));
          }
        }
      }
    }

    for (const dir of this.emptyDirs) {
      if (!isWithin(root, dir)) continue;
      if (dir === root) continue;
      if (recursive) {
        entries.set(dir, dirEntry(dir));
      } else if (parentDir(dir) === root) {
        entries.set(dir, dirEntry(dir));
      }
    }

    let result = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (opts.limit) result = result.slice(0, opts.limit);
    return result;
  }

  async read(
    path: string,
    opts: { range?: [number, number] } = {},
  ): Promise<ResourceFile> {
    const p = normalisePath(path);
    const file = this.files.get(p);
    if (!file) {
      // Distinguish "the path is a directory" from "nothing exists here".
      if (await this.dirExists(p)) {
        throw new ResourceFsError("not_a_file", `Path is a directory, not a file: "${p}".`);
      }
      throw new ResourceFsError("path_not_found", `File not found: "${p}".`);
    }

    const range = opts.range ?? [1, 50];
    const [start, end] = range;
    if (start < 1 || (end !== -1 && end < start)) {
      throw new ResourceFsError("invalid_range", `Invalid line range: [${start}, ${end}].`);
    }

    const text = bodyText(file.body);
    if (text === null) {
      // URL body without cachedText: ranges are ignored.
      return cloneFile(file);
    }
    const lines = text.split("\n");
    const startIdx = start - 1;
    if (startIdx >= lines.length) {
      // Empty slice — return a clone with body emptied.
      return cloneFile(file, replaceText(file.body, ""));
    }
    const endIdx = end === -1 ? lines.length : Math.min(end, lines.length);
    const sliced = lines.slice(startIdx, endIdx).join("\n");
    return cloneFile(file, replaceText(file.body, sliced));
  }

  async stat(path: string): Promise<ResourceStat | null> {
    const p = normalisePath(path);
    const file = this.files.get(p);
    if (file) {
      return {
        path: file.path,
        kind: "file",
        contentType: file.body.type,
        size: bodySize(file.body),
        metadata: cloneMetadata(file.metadata),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      };
    }
    if (await this.dirExists(p)) {
      return {
        path: p,
        kind: "directory",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    }
    return null;
  }

  async exists(path: string): Promise<boolean> {
    const p = normalisePath(path);
    if (this.files.has(p)) return true;
    return this.dirExists(p);
  }

  // ─── Search ─────────────────────────────────────────────────────────────

  async grep(spec: GrepSpec): Promise<GrepMatch[]> {
    const root = spec.path ? normalisePath(spec.path) : "/";
    const contextLines = spec.contextLines ?? 2;
    const limit = spec.limit ?? Number.POSITIVE_INFINITY;
    const contentTypes = spec.contentTypes ? new Set(spec.contentTypes) : null;

    let regex: RegExp;
    if (spec.regex) {
      regex = new RegExp(spec.query, spec.caseSensitive ? "" : "i");
    } else {
      const escaped = spec.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(escaped, spec.caseSensitive ? "" : "i");
    }

    const matches: GrepMatch[] = [];
    for (const file of this.files.values()) {
      if (!isWithin(root, file.path)) continue;
      if (contentTypes && !contentTypes.has(file.body.type)) continue;
      const text = searchableText(file.body);
      if (text === null) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          const before = lines.slice(Math.max(0, i - contextLines), i);
          const after = lines.slice(i + 1, i + 1 + contextLines);
          matches.push({
            path: file.path,
            line: i + 1,
            text: lines[i]!,
            context: { before, after },
          });
          if (matches.length >= limit) return matches;
        }
      }
    }
    return matches;
  }

  async glob(
    pattern: string,
    opts: { path?: string; limit?: number } = {},
  ): Promise<string[]> {
    const root = opts.path ? normalisePath(opts.path) : "/";
    const out: string[] = [];
    for (const file of this.files.values()) {
      if (!isWithin(root, file.path)) continue;
      if (matchGlob(pattern, file.path)) {
        out.push(file.path);
        if (opts.limit && out.length >= opts.limit) break;
      }
    }
    return out.sort();
  }

  async searchSemantic(
    query: string,
    opts: ResourceSemanticSearchOpts = {},
  ): Promise<SemanticMatch[]> {
    if (!this.embedder) {
      throw new ResourceFsError(
        "semantic_search_unsupported",
        "This adapter was constructed without an EmbeddingAdapter.",
      );
    }
    const [queryVec] = await this.embedder.embed([query]);
    if (!queryVec) return [];

    const root = opts.path ? normalisePath(opts.path) : "/";
    const limit = opts.limit ?? 5;
    const recencyWeight = clamp(opts.recencyWeight ?? 0, 0, 1);
    const contentTypes = opts.contentTypes ? new Set(opts.contentTypes) : null;

    const halfLifeMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const candidates: SemanticMatch[] = [];
    for (const file of this.files.values()) {
      if (file.embeddingStatus !== "fresh") continue;
      if (!isWithin(root, file.path)) continue;
      if (contentTypes && !contentTypes.has(file.body.type)) continue;
      // Skip files under roots that opted out of semantic search.
      if (rootSemanticDisabled(this.schema, file.path)) continue;
      const vec = this.embeddings.get(file.path);
      if (!vec) continue;
      const distance = cosineDistance(queryVec, vec);
      const semanticScore = 1 - distance;
      const ageMs = Math.max(0, now - new Date(file.updatedAt).getTime());
      const recencyScore = Math.exp(-Math.LN2 * (ageMs / halfLifeMs));
      const score = (1 - recencyWeight) * semanticScore + recencyWeight * recencyScore;
      candidates.push({
        path: file.path,
        summary: file.metadata.summary,
        score,
        distance,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
  }

  // ─── Write ──────────────────────────────────────────────────────────────

  async write(
    path: string,
    body: ResourceBody,
    metadata: ResourceMetadata,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    validateBody(body);
    const p = normalisePath(path);
    if (await this.dirExists(p)) {
      throw new ResourceFsError("not_a_file", `Path "${p}" is a directory.`);
    }
    const now = new Date().toISOString();
    const existing = this.files.get(p);
    const semanticDisabled = rootSemanticDisabled(this.schema, p);
    const embeddingStatus: ResourceFile["embeddingStatus"] = semanticDisabled
      ? "fresh" // skip lifecycle entirely for opt-out roots
      : existing
        ? "stale"
        : "missing";
    const merged: ResourceFile = {
      path: p,
      body: cloneBody(body),
      metadata: normaliseMetadata(metadata),
      embeddingStatus,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      provenance: existing ? [...existing.provenance, provenance] : [provenance],
    };
    this.files.set(p, merged);
    if (existing) this.embeddings.delete(p);
    // Once a file lands at a path, the empty-dir marker for that path becomes invalid.
    this.emptyDirs.delete(p);
    // Drop any empty-dir markers that the new file's parent has rendered redundant.
    let pd = parentDir(p);
    while (pd !== "/") {
      this.emptyDirs.delete(pd);
      pd = parentDir(pd);
    }
  }

  async edit(
    path: string,
    oldStr: string,
    newStr: string,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const p = normalisePath(path);
    const file = this.files.get(p);
    if (!file) throw new ResourceFsError("path_not_found", `File not found: "${p}".`);
    const text = bodyText(file.body);
    if (text === null) {
      throw new ResourceFsError(
        "body_not_editable",
        `File at "${p}" has no editable body (URL bodies without cachedText are not editable).`,
      );
    }
    const idx = text.indexOf(oldStr);
    if (idx === -1) {
      throw new ResourceFsError("edit_string_not_found", `oldStr not found in "${p}".`);
    }
    if (text.indexOf(oldStr, idx + 1) !== -1) {
      throw new ResourceFsError(
        "edit_string_not_unique",
        `oldStr matches more than once in "${p}". Provide a longer, unique snippet.`,
      );
    }
    const updated = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
    file.body = replaceText(file.body, updated);
    file.updatedAt = new Date().toISOString();
    file.provenance.push(provenance);
    if (!rootSemanticDisabled(this.schema, p)) {
      file.embeddingStatus = "stale";
      this.embeddings.delete(p);
    }
  }

  async mkdir(path: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    const p = normalisePath(path);
    if (this.files.has(p)) {
      throw new ResourceFsError("path_already_exists", `A file already exists at "${p}".`);
    }
    if (await this.dirExists(p)) return;
    if (p === "/") return;
    this.emptyDirs.add(p);
  }

  async move(fromPath: string, toPath: string, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    const from = normalisePath(fromPath);
    const to = normalisePath(toPath);
    if (from === to) return;

    const file = this.files.get(from);
    const isDir = !file && (await this.dirExists(from));
    if (!file && !isDir) {
      throw new ResourceFsError("path_not_found", `Path not found: "${from}".`);
    }
    if (this.files.has(to) || this.emptyDirs.has(to)) {
      throw new ResourceFsError("path_already_exists", `Destination already exists: "${to}".`);
    }

    if (file) {
      const moved: ResourceFile = {
        ...file,
        path: to,
        updatedAt: new Date().toISOString(),
        provenance: [...file.provenance, { ...provenance, note: provenance.note ? `${provenance.note}; moved from ${from}` : `moved from ${from}` }],
      };
      this.files.delete(from);
      this.files.set(to, moved);
      const vec = this.embeddings.get(from);
      if (vec) {
        this.embeddings.delete(from);
        this.embeddings.set(to, vec);
      }
      return;
    }

    // Directory move — relocate every file under `from` to the equivalent path under `to`.
    for (const [path, f] of [...this.files.entries()]) {
      if (!isWithin(from, path)) continue;
      const newPath = to + path.slice(from.length);
      if (this.files.has(newPath)) {
        throw new ResourceFsError("path_already_exists", `Destination collides at "${newPath}".`);
      }
      this.files.delete(path);
      this.files.set(newPath, {
        ...f,
        path: newPath,
        updatedAt: new Date().toISOString(),
        provenance: [...f.provenance, { ...provenance, note: provenance.note ? `${provenance.note}; moved from ${path}` : `moved from ${path}` }],
      });
      const vec = this.embeddings.get(path);
      if (vec) {
        this.embeddings.delete(path);
        this.embeddings.set(newPath, vec);
      }
    }
    for (const dir of [...this.emptyDirs]) {
      if (isWithin(from, dir) && dir !== from) {
        const newDir = to + dir.slice(from.length);
        this.emptyDirs.delete(dir);
        this.emptyDirs.add(newDir);
      }
    }
    this.emptyDirs.delete(from);
  }

  async remove(path: string, recursive: boolean, provenance: Provenance): Promise<void> {
    requireProvenance(provenance);
    const p = normalisePath(path);
    if (this.files.has(p)) {
      this.files.delete(p);
      this.embeddings.delete(p);
      return;
    }
    if (await this.dirExists(p)) {
      if (!recursive) {
        // Refuse to remove non-empty directories without `recursive: true`.
        const childExists = [...this.files.keys()].some((k) => isWithin(p, k) && k !== p);
        if (childExists) {
          throw new ResourceFsError(
            "directory_not_empty",
            `Directory "${p}" is not empty. Pass recursive=true to remove with contents.`,
          );
        }
        this.emptyDirs.delete(p);
        return;
      }
      for (const [k, _] of [...this.files.entries()]) {
        if (isWithin(p, k) && k !== p) {
          this.files.delete(k);
          this.embeddings.delete(k);
        }
      }
      for (const dir of [...this.emptyDirs]) {
        if (isWithin(p, dir)) this.emptyDirs.delete(dir);
      }
      return;
    }
    throw new ResourceFsError("path_not_found", `Path not found: "${p}".`);
  }

  async setMetadata(
    path: string,
    patch: Partial<ResourceMetadata>,
    provenance: Provenance,
  ): Promise<void> {
    requireProvenance(provenance);
    const p = normalisePath(path);
    const file = this.files.get(p);
    if (!file) throw new ResourceFsError("path_not_found", `File not found: "${p}".`);
    const merged: ResourceMetadata = {
      ...file.metadata,
      ...patch,
      tags: patch.tags ?? file.metadata.tags,
      links: patch.links ?? file.metadata.links,
    };
    file.metadata = normaliseMetadata(merged);
    file.updatedAt = new Date().toISOString();
    file.provenance.push(provenance);
  }

  // ─── Reverse linking ────────────────────────────────────────────────────

  async linksFor(targetKind: "entity" | "episode" | "resource", targetId: string): Promise<string[]> {
    const out: string[] = [];
    for (const file of this.files.values()) {
      if (file.metadata.links.some((l) => l.kind === targetKind && l.id === targetId)) {
        out.push(file.path);
      }
    }
    return out.sort();
  }

  async replaceLinkTarget(
    fromKind: "entity" | "episode" | "resource",
    fromId: string,
    toId: string,
    provenance: Provenance,
  ): Promise<{ updated: number }> {
    requireProvenance(provenance);
    let updated = 0;
    for (const file of this.files.values()) {
      let touched = false;
      file.metadata.links = file.metadata.links.map((l) => {
        if (l.kind === fromKind && l.id === fromId) {
          touched = true;
          return { ...l, id: toId };
        }
        return l;
      });
      if (touched) {
        file.updatedAt = new Date().toISOString();
        file.provenance.push({
          ...provenance,
          note: provenance.note ? `${provenance.note}; rewrote link ${fromKind}:${fromId}->${toId}` : `rewrote link ${fromKind}:${fromId}->${toId}`,
        });
        updated++;
      }
    }
    return { updated };
  }

  // ─── Embedding lifecycle ────────────────────────────────────────────────

  async findFilesNeedingEmbedding(opts: { limit?: number } = {}): Promise<Array<{ path: string; content: string }>> {
    const out: Array<{ path: string; content: string }> = [];
    for (const file of this.files.values()) {
      if (rootSemanticDisabled(this.schema, file.path)) continue;
      if (file.embeddingStatus === "fresh") continue;
      const text = searchableText(file.body);
      if (text === null) continue;
      out.push({ path: file.path, content: text });
      if (opts.limit && out.length >= opts.limit) break;
    }
    return out;
  }

  async setEmbedding(path: string, vector: number[]): Promise<void> {
    const p = normalisePath(path);
    const file = this.files.get(p);
    if (!file) throw new MemoryNotFoundError(`No file at "${p}".`);
    if (this.embedder && vector.length !== this.embedder.dimensions) {
      throw new MemoryWriteError("validation_failed", `Vector length ${vector.length} mismatches embedder dimensions ${this.embedder.dimensions}.`);
    }
    this.embeddings.set(p, [...vector]);
    file.embeddingStatus = "fresh";
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async dirExists(p: string): Promise<boolean> {
    if (p === "/") return true;
    if (this.emptyDirs.has(p)) return true;
    for (const file of this.files.keys()) {
      if (isWithin(p, file) && file !== p) return true;
    }
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fileEntry(file: ResourceFile): DirectoryEntry {
  return {
    name: basename(file.path),
    path: file.path,
    kind: "file",
    contentType: file.body.type,
    size: bodySize(file.body),
    summary: file.metadata.summary,
    tags: file.metadata.tags.length > 0 ? [...file.metadata.tags] : undefined,
    updatedAt: file.updatedAt,
  };
}

function dirEntry(path: string): DirectoryEntry {
  return { name: basename(path), path, kind: "directory" };
}

function cloneFile(file: ResourceFile, body?: ResourceBody): ResourceFile {
  return {
    ...file,
    body: body ? cloneBody(body) : cloneBody(file.body),
    metadata: cloneMetadata(file.metadata),
    provenance: [...file.provenance],
  };
}

function cloneBody(body: ResourceBody): ResourceBody {
  if (body.type === "url") return { ...body };
  return { ...body };
}

function cloneMetadata(m: ResourceMetadata): ResourceMetadata {
  return {
    ...m,
    tags: [...m.tags],
    links: m.links.map((l) => ({ ...l })),
  };
}

function normaliseMetadata(m: ResourceMetadata): ResourceMetadata {
  return {
    ...m,
    tags: Array.isArray(m.tags) ? [...m.tags] : [],
    links: Array.isArray(m.links) ? m.links.map((l: Link) => ({ ...l })) : [],
  };
}

function bodyText(body: ResourceBody): string | null {
  if (body.type === "text" || body.type === "markdown") return body.text;
  if (body.type === "url") return body.cachedText ?? null;
  return null;
}

function replaceText(body: ResourceBody, text: string): ResourceBody {
  if (body.type === "text") return { type: "text", text };
  if (body.type === "markdown") return { type: "markdown", text };
  if (body.type === "url") return { type: "url", url: body.url, cachedText: text };
  return body;
}

function validateBody(body: ResourceBody): void {
  if (!body || typeof body !== "object") {
    throw new ResourceFsError("binary_not_supported", "Body must be a text, markdown, or url object.");
  }
  if (body.type === "text" || body.type === "markdown") {
    if (typeof body.text !== "string") {
      throw new ResourceFsError("binary_not_supported", `Text/markdown body must include a string \`text\`.`);
    }
    return;
  }
  if (body.type === "url") {
    if (typeof body.url !== "string" || body.url.length === 0) {
      throw new ResourceFsError("binary_not_supported", "URL body must include a non-empty `url` string.");
    }
    return;
  }
  throw new ResourceFsError("binary_not_supported", `Unknown body type: ${(body as { type: string }).type}.`);
}

function rootSemanticDisabled(schema: MemorySchema, path: string): boolean {
  for (const root of schema.listResourceRoots()) {
    if (isWithin(root.path, path) && root.semanticSearch === false) return true;
  }
  return false;
}

function requireProvenance(p: Provenance | undefined): asserts p is Provenance {
  if (!p || typeof p !== "object" || typeof p.source !== "string" || typeof p.actor !== "string" || typeof p.timestamp !== "string") {
    throw new MemoryWriteError("provenance_required", "A provenance record is required on every write.");
  }
}

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
