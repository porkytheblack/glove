/**
 * A `glove-memory` resource filesystem backed by a {@link Vfs}.
 *
 * This is the bridge that stops "the agent's notes" and "the agent's files"
 * from being two different places. Point `useResourcesCurator` at the result
 * and `glove_resources_read` reads the same bytes a script wrote, at the same
 * path, in the same tree.
 *
 * ```ts
 * const fs = withMeta(mountFs([{ at: "/", fs: inMemoryFs() }]), { lexical: true });
 * useResourcesCurator(glove, vfsResources(fs, { schema, root: "/memory" }));
 * createWorkingEnvironment({ filesystem: fs });
 * ```
 *
 * The returned object satisfies `ResourceFsAdapter` structurally — declared
 * here rather than imported, so this package keeps depending on nothing. The
 * `schema` you pass through is carried untouched.
 *
 * ## Two decisions worth knowing
 *
 * - **Paths are not translated.** `root` *scopes* the adapter to a subtree;
 *   it does not rewrite paths into it. A resource at `/memory/notes/a.md` is
 *   stored at `/memory/notes/a.md`. Translation would silently invalidate
 *   every stored `metadata.links` target, which is unvalidated absolute-path
 *   data the package explicitly does not own — the same reason
 *   `layerResources` refuses to translate.
 * - **A file nobody wrote through this adapter is still a resource.** It
 *   reads back as `text` (or `markdown` for `.md`) with empty metadata,
 *   because the alternative — refusing to show a file that plainly exists —
 *   is how you end up back with two filesystems.
 */
import { basename, isUnder, normalizePath, PathError } from "./paths";
import { glob as globFiles, grep as grepFiles } from "./search";
import {
  hasMeta,
  hasSearch,
  looksBinary,
  toBytes,
  toText,
  type GrepMatch,
  type GrepSpec,
  type SemanticMatch,
  type SemanticSearchOpts,
  type Vfs,
  type VfsLink,
  type VfsProvenance,
} from "./types";

// --- structural mirrors of the glove-memory resource vocabulary -------------

export type ResourceBody =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
  | { type: "url"; url: string; cachedText?: string };

export interface ResourceMetadata {
  summary?: string;
  tags: string[];
  links: VfsLink[];
  [key: string]: unknown;
}

export interface ResourceFile {
  path: string;
  body: ResourceBody;
  metadata: ResourceMetadata;
  embeddingStatus: "missing" | "fresh" | "stale";
  createdAt: string;
  updatedAt: string;
  provenance: VfsProvenance[];
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
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

export interface VfsResourcesOptions<TSchema> {
  /** Passed straight through to the adapter's `schema` field. */
  schema: TSchema;
  /** Restrict the adapter to a subtree. Scoping only — paths are NOT rewritten. */
  root?: string;
  identifier?: string;
}

/** The `ResourceFsAdapter` shape, declared structurally. */
export interface VfsResourceAdapter<TSchema> {
  identifier: string;
  schema: TSchema;
  supportsSemanticSearch: boolean;
  list(path: string, opts?: { recursive?: boolean; limit?: number }): Promise<DirectoryEntry[]>;
  read(path: string, opts?: { range?: [number, number] }): Promise<ResourceFile>;
  stat(path: string): Promise<ResourceStat | null>;
  exists(path: string): Promise<boolean>;
  grep(spec: GrepSpec): Promise<GrepMatch[]>;
  glob(pattern: string, opts?: { path?: string; limit?: number }): Promise<string[]>;
  searchSemantic?(query: string, opts?: SemanticSearchOpts): Promise<SemanticMatch[]>;
  write(path: string, body: ResourceBody, metadata: ResourceMetadata, provenance: VfsProvenance): Promise<void>;
  edit(path: string, oldStr: string, newStr: string, provenance: VfsProvenance): Promise<void>;
  mkdir(path: string, provenance: VfsProvenance): Promise<void>;
  move(fromPath: string, toPath: string, provenance: VfsProvenance): Promise<void>;
  remove(path: string, recursive: boolean, provenance: VfsProvenance): Promise<void>;
  setMetadata(path: string, patch: Partial<ResourceMetadata>, provenance: VfsProvenance): Promise<void>;
  linksFor(targetKind: VfsLink["kind"], targetId: string): Promise<string[]>;
  replaceLinkTarget(
    fromKind: VfsLink["kind"],
    fromId: string,
    toId: string,
    provenance: VfsProvenance,
  ): Promise<{ updated: number }>;
  findFilesNeedingEmbedding?(opts?: { limit?: number }): Promise<Array<{ path: string; content: string }>>;
  setEmbedding?(path: string, vector: number[]): Promise<void>;
}

/** Marker for a URL-bodied resource, which has no natural byte representation. */
const URL_BODY_KEY = "$vfsUrlBody";

function encodeBody(body: ResourceBody): Uint8Array {
  if (body.type === "url") {
    return toBytes(JSON.stringify({ [URL_BODY_KEY]: 1, url: body.url, cachedText: body.cachedText }));
  }
  return toBytes(body.text);
}

function decodeBody(path: string, bytes: Uint8Array): ResourceBody {
  const text = toText(bytes);
  if (text.startsWith("{") && text.includes(URL_BODY_KEY)) {
    try {
      const parsed = JSON.parse(text) as { [URL_BODY_KEY]?: number; url?: string; cachedText?: string };
      if (parsed[URL_BODY_KEY] && typeof parsed.url === "string") {
        return { type: "url", url: parsed.url, cachedText: parsed.cachedText };
      }
    } catch {
      // Not an envelope after all — it is a JSON file, and JSON is text.
    }
  }
  return path.endsWith(".md") ? { type: "markdown", text } : { type: "text", text };
}

function contentTypeOf(body: ResourceBody): "text" | "markdown" | "url" {
  return body.type;
}

function emptyMetadata(): ResourceMetadata {
  return { tags: [], links: [] };
}

/**
 * Build a `ResourceFsAdapter` over a filesystem.
 *
 * Metadata (summaries, tags, links, provenance) needs a metadata-capable
 * tree — wrap yours in {@link withMeta} if it is a plain one. Without it the
 * adapter still works: reads, listings, grep and writes all function, and
 * metadata simply comes back empty rather than throwing, which keeps a plain
 * tree usable rather than half-broken.
 */
export function vfsResources<TSchema>(vfs: Vfs, options: VfsResourcesOptions<TSchema>): VfsResourceAdapter<TSchema> {
  const root = normalizePath(options.root ?? "/");
  const meta = hasMeta(vfs) ? vfs : null;
  const search = hasSearch(vfs) ? vfs : null;

  const scope = (path: string): string => {
    const p = normalizePath(path);
    if (!isUnder(p, root)) {
      throw new PathError(`${p} is outside this resource store, which is scoped to ${root}`);
    }
    return p;
  };

  const visible = async (): Promise<string[]> => (await vfs.files()).filter((f) => isUnder(f, root));

  const recordFor = async (path: string) => (meta ? await meta.getMeta(path) : null);

  return {
    identifier: options.identifier ?? `vfs-resources:${root}`,
    schema: options.schema,
    supportsSemanticSearch: search !== null,

    async list(path, opts) {
      const p = scope(path);
      const out: DirectoryEntry[] = [];
      if (opts?.recursive) {
        for (const f of await visible()) {
          if (!isUnder(f, p) || f === p) continue;
          out.push(await entryFor(f, "file"));
        }
      } else {
        for (const e of await vfs.list(p)) {
          const child = normalizePath(p === "/" ? `/${e.name}` : `${p}/${e.name}`);
          if (!isUnder(child, root)) continue;
          out.push(await entryFor(child, e.kind === "dir" ? "directory" : "file", e.size));
        }
      }
      out.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "directory" ? -1 : 1));
      return opts?.limit ? out.slice(0, opts.limit) : out;
    },

    async read(path, opts) {
      const p = scope(path);
      const bytes = await vfs.read(p);
      if (looksBinary(bytes)) {
        throw new PathError(`${p} is binary — the resource store is text-only. Link to it from a text resource instead.`);
      }
      let body = decodeBody(p, bytes);
      const range = opts?.range ?? [1, 50];
      if (body.type !== "url") {
        const lines = body.text.split("\n");
        const from = Math.max(0, range[0] - 1);
        const to = range[1] === -1 ? lines.length : Math.min(lines.length, range[1]);
        body = { type: body.type, text: lines.slice(from, to).join("\n") };
      }
      const rec = await recordFor(p);
      return {
        path: p,
        body,
        metadata: (rec?.metadata as ResourceMetadata) ?? emptyMetadata(),
        embeddingStatus: rec?.embeddingStatus ?? "missing",
        createdAt: rec?.createdAt ?? new Date(0).toISOString(),
        updatedAt: rec?.updatedAt ?? new Date(0).toISOString(),
        provenance: rec?.provenance ?? [],
      };
    },

    async stat(path) {
      const p = scope(path);
      const s = await vfs.stat(p);
      if (!s) return null;
      const rec = await recordFor(p);
      const base = {
        path: p,
        createdAt: rec?.createdAt ?? new Date(s.mtime).toISOString(),
        updatedAt: rec?.updatedAt ?? new Date(s.mtime).toISOString(),
        metadata: (rec?.metadata as ResourceMetadata) ?? undefined,
      };
      if (s.kind === "dir") return { ...base, kind: "directory" };
      return {
        ...base,
        kind: "file",
        size: s.size,
        contentType: contentTypeOf(decodeBody(p, await vfs.read(p))),
      };
    },

    async exists(path) {
      const p = normalizePath(path);
      return isUnder(p, root) ? vfs.exists(p) : false;
    },

    async grep(spec) {
      return grepFiles(vfs, { ...spec, path: scope(spec.path ?? root) });
    },

    async glob(pattern, opts) {
      const hits = (await globFiles(vfs, pattern, { path: opts?.path ?? root })).filter((f) => isUnder(f, root));
      return opts?.limit ? hits.slice(0, opts.limit) : hits;
    },

    ...(search
      ? {
          searchSemantic: async (query: string, opts?: SemanticSearchOpts) =>
            (await search.searchSemantic(query, { ...opts, path: opts?.path ?? root })).filter((m) =>
              isUnder(m.path, root),
            ),
        }
      : {}),

    async write(path, body, metadata, provenance) {
      const p = scope(path);
      await vfs.write(p, encodeBody(body));
      if (meta) await meta.setMeta(p, metadata, provenance);
    },

    async edit(path, oldStr, newStr, provenance) {
      const p = scope(path);
      const body = decodeBody(p, await vfs.read(p));
      if (body.type === "url") throw new PathError(`cannot edit ${p}: it is a URL resource, not a text body`);
      const first = body.text.indexOf(oldStr);
      if (first === -1) throw new PathError(`cannot edit ${p}: the text to replace was not found`);
      if (body.text.indexOf(oldStr, first + 1) !== -1) {
        throw new PathError(`cannot edit ${p}: the text to replace appears more than once — include more context to make it unique`);
      }
      await vfs.write(p, toBytes(body.text.slice(0, first) + newStr + body.text.slice(first + oldStr.length)));
      if (meta) await meta.setMeta(p, {}, provenance);
    },

    async mkdir(path, _provenance) {
      await vfs.mkdir(scope(path));
    },

    async move(fromPath, toPath, provenance) {
      const from = scope(fromPath);
      const to = scope(toPath);
      const stat = await vfs.stat(from);
      if (!stat) throw new PathError(`no such path: ${from}`);
      if (stat.kind === "dir") {
        const prefix = from === "/" ? "/" : from + "/";
        for (const f of await visible()) {
          if (!f.startsWith(prefix)) continue;
          const dest = normalizePath(`${to}/${f.slice(prefix.length)}`);
          await vfs.write(dest, await vfs.read(f));
          if (meta) {
            const rec = await meta.getMeta(f);
            if (rec) await meta.setMeta(dest, rec.metadata, provenance);
          }
        }
      } else {
        await vfs.write(to, await vfs.read(from));
        if (meta) {
          const rec = await meta.getMeta(from);
          await meta.setMeta(to, rec?.metadata ?? emptyMetadata(), provenance);
        }
      }
      await vfs.rm(from);
    },

    async remove(path, recursive, _provenance) {
      const p = scope(path);
      const stat = await vfs.stat(p);
      if (stat?.kind === "dir" && !recursive) {
        const prefix = p === "/" ? "/" : p + "/";
        if ((await visible()).some((f) => f.startsWith(prefix))) {
          throw new PathError(`cannot remove ${p}: it is not empty — pass recursive to remove it and everything under it`);
        }
      }
      await vfs.rm(p);
    },

    async setMetadata(path, patch, provenance) {
      const p = scope(path);
      if (!meta) {
        throw new PathError(
          `cannot set metadata on ${p}: this filesystem stores no metadata. Wrap it in withMeta() from glove-vfs.`,
        );
      }
      await meta.setMeta(p, patch, provenance);
    },

    async linksFor(targetKind, targetId) {
      if (!meta) return [];
      return (await meta.linksFor(targetKind, targetId)).map((l) => l.path).filter((p) => isUnder(p, root));
    },

    async replaceLinkTarget(fromKind, fromId, toId, provenance) {
      if (!meta) return { updated: 0 };
      return { updated: await meta.replaceLinkTarget(fromKind, fromId, toId, provenance) };
    },

    ...(search
      ? {
          findFilesNeedingEmbedding: async (opts?: { limit?: number }) => {
            const paths = (await search.findNeedingEmbedding(opts)).filter((p) => isUnder(p, root));
            const out: Array<{ path: string; content: string }> = [];
            for (const p of paths) {
              const bytes = await vfs.read(p);
              if (looksBinary(bytes)) continue;
              const body = decodeBody(p, bytes);
              out.push({ path: p, content: body.type === "url" ? (body.cachedText ?? body.url) : body.text });
            }
            return out;
          },
          setEmbedding: (path: string, vector: number[]) => search.setEmbedding(scope(path), vector),
        }
      : {}),
  };

  async function entryFor(path: string, kind: "file" | "directory", size?: number): Promise<DirectoryEntry> {
    const rec = await recordFor(path);
    const entry: DirectoryEntry = { name: basename(path), path, kind };
    if (kind === "file") {
      entry.size = size ?? (await vfs.stat(path))?.size;
      entry.contentType = path.endsWith(".md") ? "markdown" : "text";
    }
    if (rec) {
      entry.summary = rec.metadata.summary;
      entry.tags = rec.metadata.tags;
      entry.updatedAt = rec.updatedAt;
    }
    return entry;
  }
}
