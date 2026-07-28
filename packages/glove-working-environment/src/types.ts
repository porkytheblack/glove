/**
 * Shared contracts for the working environment: the pluggable filesystem
 * adapter, the stdlib adapter bridge, resource limits, and the model-facing
 * tool shape. Everything here is zero-dependency — the tool shape is
 * structurally compatible with glove-core's `GloveFoldArgs` without importing
 * it.
 */

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
  /** Factory producing the actual bindings. ALL I/O goes through the given VFS handle. */
  create(vfs: EnvFsHandle): Record<string, unknown>;
}

/**
 * The guarded, text-friendly VFS handle given to stdlib adapters and to the
 * `env:fs` builtin. Mutations flow through the environment's zones, limits,
 * script pipeline, and version recording — exactly like the model-facing
 * verbs.
 */
export interface EnvFsHandle {
  readFile(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
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
  /** Total bytes across all files (including versions and history). Default 256 MiB. */
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
export class EnvLimitError extends Error {}

export const DEFAULT_LIMITS: EnvLimits = {
  runTimeoutMs: 30_000,
  maxVfsBytes: 256 * 1024 * 1024,
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
