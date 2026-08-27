/**
 * The filesystem as callable functions, for the sandboxed REPLs
 * (`glove-js`, `glove-lisp`, `glove-python`).
 *
 * These are `ToolFn`s in the shape `glove-scratchpad/fns` defines — declared
 * structurally here so this package depends on none of those. Register them
 * and `execute_js` can do:
 *
 * ```js
 * const stale = [];
 * for (const p of await fs.glob("/memory/**\/*.md")) {
 *   const m = await fs.meta({ path: p });
 *   if (m && m.embeddingStatus !== "fresh") stale.push(p);
 * }
 * stale.length
 * ```
 *
 * ## Why functions and not verbs
 *
 * A verb puts every answer in the context window, so checking forty files
 * costs forty round trips and forty rendered results. The same capability as
 * a function lets the model loop and return one line. That is the whole
 * argument for handing a REPL the filesystem — and it is also why a REPL
 * session stops being a private scratch space: an intermediate it computes
 * can now be written where a script or the memory tools will find it.
 *
 * The `fs__` prefix is the namespace convention those REPLs already use, so
 * the functions arrive as `fs.read(...)` in JS and Python and `(fs__read …)`
 * in Lisp without any per-REPL wiring.
 */
import { basename, normalizePath } from "./paths";
import { glob as globFiles, grep as grepFiles } from "./search";
import {
  hasMeta,
  hasSearch,
  looksBinary,
  toBytes,
  toText,
  type Vfs,
  type VfsMetadata,
  type VfsProvenance,
} from "./types";
import { base64ToBytes, bytesToBase64 } from "./backends/memory";

/** Structural mirror of `glove-scratchpad/fns`' `ToolFnContext`. */
export interface FsFnContext {
  signal?: AbortSignal;
  actor?: string;
}

/** Structural mirror of `glove-scratchpad/fns`' `ToolFn`. */
export interface FsFn {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  readOnlyHint?: boolean;
  resultShape?: string;
  server?: string;
  serverDescription?: string;
  call(args: Record<string, unknown>, ctx?: FsFnContext): Promise<unknown>;
}

export interface FsFnsOptions {
  /** Namespace prefix. Default `"fs"` → `fs.read(...)`. */
  namespace?: string;
  /**
   * Refuse a read above this many bytes. Default 2 MiB. The refusal names
   * `fs.grep` and the `limit`/`offset` arguments, because the answer to "this
   * file is enormous" is nearly always a search, not a bigger buffer.
   */
  maxReadBytes?: number;
  /** Hide the mutating functions — a REPL that may look but not touch. */
  readOnly?: boolean;
  /** Stamped as provenance on metadata writes when the tree records it. */
  provenance?: (ctx?: FsFnContext) => VfsProvenance;
}

const DEFAULT_MAX_READ = 2 * 1024 * 1024;

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${key} is required and must be a non-empty string`);
  }
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const S = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
} as const;

function schema(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties: props, required, additionalProperties: false };
}

/**
 * Build the filesystem function catalog for a REPL session.
 *
 * Metadata and search functions appear only when the tree actually provides
 * them ({@link hasMeta} / {@link hasSearch}), so a model never sees a call it
 * cannot make.
 */
export function fsFns(vfs: Vfs, options: FsFnsOptions = {}): FsFn[] {
  const ns = options.namespace ?? "fs";
  const maxRead = options.maxReadBytes ?? DEFAULT_MAX_READ;
  const serverDescription = "The agent's virtual filesystem — one tree shared with scripts, memory and the working environment.";

  const fn = (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    readOnlyHint: boolean,
    resultShape: string,
    call: (args: Record<string, unknown>, ctx?: FsFnContext) => Promise<unknown>,
  ): FsFn => ({
    name: `${ns}__${name}`,
    description,
    inputSchema,
    readOnlyHint,
    resultShape,
    server: ns,
    serverDescription,
    call,
  });

  const read = fn(
    "read",
    "Read a file. Text by default; pass encoding:'base64' for binary. Use offset/limit (in lines) on large files.",
    schema({ path: S.string, encoding: S.string, offset: S.number, limit: S.number }, ["path"]),
    true,
    "string",
    async (args) => {
      const path = normalizePath(str(args, "path"));
      const stat = await vfs.stat(path);
      if (stat?.kind === "dir") throw new Error(`${path} is a directory — use ${ns}.ls`);
      if (stat && stat.size > maxRead) {
        throw new Error(
          `${path} is ${stat.size} bytes, above the ${maxRead}-byte read limit. ` +
            `Search it with ${ns}.grep({ query, path: '${path}' }), or read a slice with offset/limit.`,
        );
      }
      const bytes = await vfs.read(path);
      if (optStr(args, "encoding") === "base64") return bytesToBase64(bytes);
      if (looksBinary(bytes)) {
        throw new Error(`${path} is binary — read it with encoding:'base64', or describe it with ${ns}.stat`);
      }
      const text = toText(bytes);
      const offset = optNum(args, "offset");
      const limit = optNum(args, "limit");
      if (offset === undefined && limit === undefined) return text;
      const lines = text.split("\n");
      const from = Math.max(0, (offset ?? 1) - 1);
      return lines.slice(from, limit === undefined ? undefined : from + limit).join("\n");
    },
  );

  const ls = fn(
    "ls",
    "List a directory's immediate children.",
    schema({ path: S.string }, []),
    true,
    "{ name: string, kind: 'file' | 'dir', size: number }[]",
    async (args) => vfs.list(optStr(args, "path") ?? "/"),
  );

  const stat = fn(
    "stat",
    "Size, kind and last-modified time for one path, without reading it.",
    schema({ path: S.string }, ["path"]),
    true,
    "{ path: string, kind: 'file' | 'dir', size: number, mtime: number } | null",
    async (args) => {
      const path = normalizePath(str(args, "path"));
      const s = await vfs.stat(path);
      return s ? { path, ...s } : null;
    },
  );

  const globFn = fn(
    "glob",
    "Every file path matching a glob (** crosses directories, * does not).",
    schema({ pattern: S.string, path: S.string }, ["pattern"]),
    true,
    "string[]",
    async (args) => globFiles(vfs, str(args, "pattern"), { path: optStr(args, "path") }),
  );

  const grepFn = fn(
    "grep",
    "Search file contents. Literal substring by default; set regex:true for a pattern.",
    schema(
      {
        query: S.string,
        path: S.string,
        glob: S.string,
        regex: S.boolean,
        caseSensitive: S.boolean,
        contextLines: S.number,
        limit: S.number,
      },
      ["query"],
    ),
    true,
    "{ path: string, line: number, text: string }[]",
    async (args) =>
      grepFiles(vfs, {
        query: str(args, "query"),
        path: optStr(args, "path"),
        glob: optStr(args, "glob"),
        regex: args.regex === true,
        caseSensitive: args.caseSensitive === true,
        contextLines: optNum(args, "contextLines"),
        limit: optNum(args, "limit"),
      }),
  );

  const fns: FsFn[] = [read, ls, stat, globFn, grepFn];

  if (!options.readOnly) {
    fns.push(
      fn(
        "write",
        "Create or overwrite a file. Parent directories are created as needed.",
        schema({ path: S.string, content: S.string, encoding: S.string }, ["path", "content"]),
        false,
        "{ path: string, bytes: number }",
        async (args) => {
          const path = normalizePath(str(args, "path"));
          const content = str(args, "content");
          const bytes = optStr(args, "encoding") === "base64" ? base64ToBytes(content) : toBytes(content);
          await vfs.write(path, bytes);
          return { path, bytes: bytes.byteLength };
        },
      ),
      fn(
        "mkdir",
        "Create a directory (and its parents).",
        schema({ path: S.string }, ["path"]),
        false,
        "{ path: string }",
        async (args) => {
          const path = normalizePath(str(args, "path"));
          await vfs.mkdir(path);
          return { path };
        },
      ),
      fn(
        "rm",
        "Remove a file, or a directory and everything under it.",
        schema({ path: S.string }, ["path"]),
        false,
        "{ path: string }",
        async (args) => {
          const path = normalizePath(str(args, "path"));
          await vfs.rm(path);
          return { path };
        },
      ),
      fn(
        "mv",
        "Move or rename a path.",
        schema({ from: S.string, to: S.string }, ["from", "to"]),
        false,
        "{ from: string, to: string }",
        async (args) => {
          const from = normalizePath(str(args, "from"));
          const to = normalizePath(str(args, "to"));
          await copyPath(vfs, from, to);
          await vfs.rm(from);
          return { from, to };
        },
      ),
      fn(
        "cp",
        "Copy a file, or a directory and everything under it.",
        schema({ from: S.string, to: S.string }, ["from", "to"]),
        false,
        "{ from: string, to: string }",
        async (args) => {
          const from = normalizePath(str(args, "from"));
          const to = normalizePath(str(args, "to"));
          await copyPath(vfs, from, to);
          return { from, to };
        },
      ),
    );
  }

  if (hasMeta(vfs)) {
    fns.push(
      fn(
        "meta",
        "Metadata for one path — summary, tags, links, provenance, index freshness.",
        schema({ path: S.string }, ["path"]),
        true,
        "{ path: string, metadata: { summary?: string, tags: string[], links: object[] }, embeddingStatus: string } | null",
        async (args) => vfs.getMeta(normalizePath(str(args, "path"))),
      ),
      fn(
        "links_for",
        "Every file whose metadata links to a target (an entity id, an episode id, or a path).",
        schema({ kind: S.string, id: S.string }, ["kind", "id"]),
        true,
        "{ path: string, relation?: string }[]",
        async (args) => vfs.linksFor(str(args, "kind") as "entity", str(args, "id")),
      ),
    );
    if (!options.readOnly) {
      fns.push(
        fn(
          "set_meta",
          "Patch a file's metadata without rewriting its content. Omitted keys are left alone.",
          schema({ path: S.string, summary: S.string, tags: { type: "array", items: S.string }, links: { type: "array" } }, [
            "path",
          ]),
          false,
          "{ path: string }",
          async (args, ctx) => {
            const path = normalizePath(str(args, "path"));
            const patch: Partial<VfsMetadata> = {};
            if (typeof args.summary === "string") patch.summary = args.summary;
            if (Array.isArray(args.tags)) patch.tags = args.tags as string[];
            if (Array.isArray(args.links)) patch.links = args.links as VfsMetadata["links"];
            await vfs.setMeta(path, patch, options.provenance?.(ctx));
            return { path };
          },
        ),
      );
    }
  }

  if (hasSearch(vfs)) {
    fns.push(
      fn(
        "search",
        "Content search across the tree, ranked by relevance rather than exact text.",
        schema({ query: S.string, path: S.string, limit: S.number, recencyWeight: S.number }, ["query"]),
        true,
        "{ path: string, summary?: string, score: number }[]",
        async (args) =>
          vfs.searchSemantic(str(args, "query"), {
            path: optStr(args, "path"),
            limit: optNum(args, "limit"),
            recencyWeight: optNum(args, "recencyWeight"),
          }),
      ),
    );
  }

  return fns;
}

/** Copy a file or a whole subtree. Shared by `cp` and `mv`. */
async function copyPath(vfs: Vfs, from: string, to: string): Promise<void> {
  const stat = await vfs.stat(from);
  if (!stat) throw new Error(`no such file or directory: ${from}`);
  if (stat.kind === "file") {
    await vfs.write(to, await vfs.read(from));
    return;
  }
  const prefix = from === "/" ? "/" : from + "/";
  const under = (await vfs.files()).filter((f) => f.startsWith(prefix));
  if (under.length === 0) {
    await vfs.mkdir(to);
    return;
  }
  for (const f of under) {
    await vfs.write(normalizePath(`${to}/${f.slice(prefix.length)}`), await vfs.read(f));
  }
}

/** The one-line orientation a host can paste into a system prompt. */
export function describeFsFns(vfs: Vfs, options: FsFnsOptions = {}): string {
  const ns = options.namespace ?? "fs";
  const names = fsFns(vfs, options).map((f) => `${ns}.${basename(f.name.replace(`${ns}__`, ""))}`);
  return `A shared filesystem is callable as ${names.join(", ")}. Paths are absolute. State written there outlives this call.`;
}
