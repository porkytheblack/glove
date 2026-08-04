/**
 * Shared contracts for the working environment: the pluggable filesystem
 * adapter, the stdlib adapter bridge, resource limits, and the model-facing
 * tool shape. Everything here is zero-dependency — the tool shape is
 * structurally compatible with glove-core's `GloveFoldArgs` without importing
 * it.
 */
import type { HandlesSpec } from "./adapters/handles";

export type { HandlesSpec };

/** A single entry returned by {@link Vfs.list}. */
export interface VfsEntry {
  name: string;
  kind: "file" | "dir";
  /** Byte size for files, 0 for directories. */
  size: number;
}

export interface VfsStat {
  kind: "file" | "dir";
  size: number;
  /** ms since epoch of the last mutation. */
  mtime: number;
}

/**
 * The pluggable filesystem contract. Paths are absolute, `/`-separated
 * virtual paths. The default implementation is {@link inMemoryFs}; alternate
 * backends (e.g. a copy-on-write overlay) implement the same surface.
 *
 * The raw Vfs knows nothing about scripts, zones, versions, or limits —
 * those live in the environment layer above it.
 */
export interface Vfs {
  read(path: string): Promise<Uint8Array>;
  /** Writes a file, creating parent directories as needed. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Removes a file, or a directory and everything under it. */
  rm(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<VfsStat | null>;
  /** Lists the immediate children of a directory. */
  list(path: string): Promise<VfsEntry[]>;
  /** Every file path in the tree (no directories), sorted. */
  files(): Promise<string[]>;
  /** Total bytes of file content currently stored. */
  totalSize(): Promise<number>;
}

/** Serializable snapshot of an entire environment tree. */
export interface EnvSnapshot {
  version: 1;
  /** Directories that exist (including empty ones). */
  dirs: string[];
  /** File contents, base64-encoded. */
  files: Array<{ path: string; data: string; mtime: number }>;
}

/**
 * A stdlib adapter bridges a real host-side library into the environment.
 * Scripts import it as `env:<name>`; its docs are materialized read-only
 * under `/std/<name>/`.
 *
 * `create(vfs)` is the capability boundary: every function the adapter
 * exposes must do its I/O exclusively through the given VFS handle. An
 * adapter that reaches for the network or the host filesystem is breaking
 * the contract — the environment cannot detect it, so don't do it.
 *
 * Prefer `defineAdapter` over writing this shape by hand: it checks the spec
 * eagerly and keeps the binding types.
 */
export interface StdlibAdapter {
  /** Module name: `"documents"` → scripts do `import { pdf } from 'env:documents'`. */
  name: string;
  /** One-liner surfaced in the tool description and in `ls /std`. */
  description: string;
  /** `.d.ts` source describing the module's exports (materialized at /std/<name>/index.d.ts). */
  types: string;
  /** Optional README with worked examples (materialized at /std/<name>/README.md). */
  docs?: string;
  /**
   * The files this adapter understands, by extension and/or magic bytes. When
   * present alongside a `describe(path)` binding, the `describe` verb routes
   * matching files here and `ls` names the module beside them.
   */
  handles?: HandlesSpec;
  /**
   * Factory producing the actual bindings. ALL I/O goes through the given VFS
   * handle.
   *
   * Called twice per environment — once for normal execution and once for the
   * read-only instance backing write-time script validation — so it must be
   * free of side effects outside the handle. `ctx.readOnly` distinguishes
   * them; most adapters can ignore it.
   */
  create(vfs: EnvFsHandle, ctx?: { name: string; readOnly: boolean }): Record<string, unknown>;
  /**
   * Worked recipes, materialized under `/skills` and listed in its index.
   *
   * `types` says what the module exports; a skill says how to do a task with
   * it. Both matter, and they are read at different moments — a model reaches
   * for a remembered shape before it reads a signature, which is why the most
   * common failures in this environment are guessed imports rather than
   * misused ones.
   */
  skills?: Array<{ name: string; summary: string; body: string }>;
}

/**
 * The guarded, text-friendly VFS handle given to stdlib adapters and to the
 * `env:fs` builtin. Mutations flow through the environment's zones, limits,
 * script pipeline, and version recording — exactly like the model-facing
 * verbs.
 */
export interface EnvFsHandle {
  /**
   * The environment's resource limits, so an adapter can size its work
   * instead of only failing late.
   *
   * The gateway enforces these on every write regardless; what this buys is
   * the chance to refuse BEFORE doing something expensive — inflating an
   * archive that cannot fit, allocating a canvas for a page count that will
   * never be written.
   */
  readonly limits: EnvLimits;
  readFile(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** Append to a file, creating it if absent. */
  appendFile(path: string, content: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<VfsEntry[]>;
  glob(pattern: string): Promise<string[]>;
  stat(path: string): Promise<VfsStat | null>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  mv(from: string, to: string): Promise<void>;
  cp(from: string, to: string): Promise<void>;
}

/** Resource limits. Every limit failure names the limit it hit. */
export interface EnvLimits {
  /** Wall-clock budget per run_script (and per write-time validation). Default 30_000. */
  runTimeoutMs: number;
  /**
   * Total bytes across all files (including versions and history). Default
   * 128 MiB.
   *
   * With the default in-memory filesystem this is host **heap**, and it is
   * per environment — a host running N agents in one process must be able to
   * afford `N * maxVfsBytes` on top of everything else. Size it deliberately
   * for a multi-tenant host; the default assumes an agent working on a
   * handful of documents, not a bulk pipeline.
   *
   * Erring low is the safe direction: too low is a named, actionable error
   * the operator raises in one line, while too high is a process the OOM
   * killer takes down along with every other agent inside it.
   */
  maxVfsBytes: number;
  /** Bytes for any single file. Default 32 MiB. */
  maxFileBytes: number;
  /** Serialized bytes a tool response may carry before spilling to /tmp. Default 8192. */
  maxToolResponseBytes: number;
  /** Lines a tool response may carry before truncating/spilling. Default 200. */
  maxToolResponseLines: number;
  /** Per-file undo ring depth. Default 10. */
  maxVersionsPerFile: number;
  /** history.jsonl ring depth in lines. Default 5000. */
  maxHistoryLines: number;
}

/** Thrown when a configured resource limit is hit. The message names the limit. */
export class EnvLimitError extends Error {
  constructor(message: string) {
    super(message);
    // Only `name` and `message` survive the realm bridge, so the name is the
    // only way a script can tell a limit apart from an ordinary failure.
    this.name = "EnvLimitError";
  }
}

export const DEFAULT_LIMITS: EnvLimits = {
  runTimeoutMs: 30_000,
  maxVfsBytes: 128 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxToolResponseBytes: 8_192,
  maxToolResponseLines: 200,
  maxVersionsPerFile: 10,
  maxHistoryLines: 5_000,
};

/** Result of one script execution. */
export interface RunResult {
  ok: boolean;
  /** The value returned by the script's default export (host-side value). */
  result: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

/**
 * Model-facing tool result — structurally a glove-core `ToolResultData`.
 */
export interface EnvToolResult {
  status: "success" | "error";
  data: unknown;
  message?: string;
}

/**
 * A model-facing verb. Structurally compatible with glove-core's
 * `GloveFoldArgs` (raw JSON Schema variant), so `glove.fold(tool)` accepts it
 * directly — without this package depending on glove-core.
 */
export interface EnvTool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  do(input: any): Promise<EnvToolResult>;
}

/**
 * The minimal structural surface of a Glove agent that
 * `mountWorkingEnvironment` needs. Any `IGloveRunnable`/`IGloveBuilder`
 * satisfies it.
 */
export interface MountableAgent {
  fold(tool: EnvTool): unknown;
  getSystemPrompt?(): string;
  setSystemPrompt?(prompt: string): unknown;
}

export interface CreateWorkingEnvironmentOptions {
  /** Filesystem backend. Default: a fresh {@link inMemoryFs}. */
  filesystem?: Vfs;
  /** Stdlib adapters to register (materialized under /std, importable as env:<name>). */
  stdlib?: StdlibAdapter[];
  /** Resource limit overrides. */
  limits?: Partial<EnvLimits>;
  /**
   * Throw at startup when stored scripts import an `env:*` module this host
   * did not register, instead of reporting it on `WorkingEnvironment.warnings`.
   * Off by default: restoring a deliberate subset of adapters is legitimate.
   */
  strictAdapters?: boolean;
  /**
   * Refuse a script write until the docs it imports have been read. Default
   * false.
   *
   * Measured: with `/skills` present and the preamble naming it first, the
   * most frequent errors across 36 agent runs were still guessed imports —
   * reading is optional and guessing is free, so guessing wins. The gate
   * inverts that for one call per module per session.
   *
   * Off pending evidence: turning it on lets a script write be refused for a
   * reason unrelated to the script, which is not a default to flip on a
   * hunch. Turn it on to trade one read call per module per session against
   * the turns a guessed import costs.
   */
  requireDocsBeforeWrite?: boolean;
  /** Script-execution tuning. Scripts always run in terminable workers. */
  execution?: {
    /**
     * Warm worker threads kept alive per environment. Default 1.
     *
     * One is right for an agent loop, which runs a script at a time. Raise it
     * only if the host genuinely runs scripts concurrently against the same
     * environment — each worker is a thread and its own heap.
     */
    size?: number;
    /**
     * Grace after `runTimeoutMs` before the worker is destroyed. Default 250ms.
     *
     * The in-worker deadline usually resolves the run first with a better
     * message; this is the backstop for when it cannot, which is exactly the
     * compute-loop case it exists for.
     */
    graceMs?: number;
    /**
     * Ceiling on a worker's JS heap, in MB. Default 256.
     *
     * The time limit alone does not make a script survivable: measured
     * without this, a script pushing arrays in a loop grew the host to 7.2
     * GiB of RSS well inside the default 30s budget, and a process that gets
     * OOM-killed takes every other agent in it along. With the ceiling, V8
     * terminates only that worker and the run fails naming this option.
     *
     * Raise it for scripts that legitimately hold large intermediates in
     * memory. Adapter work does not count against it — adapters run on the
     * host — so this bounds the model's own data structures.
     */
    memoryMb?: number;
    /**
     * How long `close()` lets an in-flight run finish before terminating it.
     * Default 5000ms. Overridable per call: `close({ graceMs })`.
     */
    shutdownGraceMs?: number;
    /**
     * Where to report a misconfigured host. Defaults to `console.warn`; point
     * it at your logger. Called at most once per environment.
     *
     * Today it reports exactly one thing: a `memoryMb` ceiling that V8 did
     * not apply because a process-level `--max-old-space-size` overrode it.
     */
    onWarning?: (message: string) => void;
  };
}

/** One recorded version of a file (for `history <path>` output). */
export interface FileVersionInfo {
  ts: number;
  /** The mutation that pushed this version. */
  op: string;
  /** Whether the file existed in this version. */
  present: boolean;
  size: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

export function toText(data: Uint8Array): string {
  return decoder.decode(data);
}

/** Cheap binary sniff: a NUL byte in the first 8 KiB means "not text". */
export function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}
