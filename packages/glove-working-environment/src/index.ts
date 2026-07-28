/**
 * glove-working-environment — a small, fast, in-memory, sandboxed
 * persistent working environment for LLM agents.
 *
 * One tree: inputs, scripts, intermediates, outputs, docs, and history all
 * live in a persistent, snapshottable virtual filesystem. Scripts execute
 * in a scope containing only injected capabilities — no networking, no
 * host filesystem access, no process spawning, by construction.
 */
import { readFile as hostReadFile } from "node:fs/promises";
import {
  DEFAULT_LIMITS,
  toBytes,
  EnvLimitError,
  type CreateWorkingEnvironmentOptions,
  type EnvFsHandle,
  type EnvLimits,
  type EnvSnapshot,
  type EnvTool,
  type RunResult,
  type StdlibAdapter,
  type Vfs,
} from "./types";
import { isUnder, normalizePath } from "./paths";
import { InMemoryFs, bytesToBase64, inMemoryFs } from "./vfs/memory";
import { EnvCore } from "./core/env";
import { ScriptExecutor, deepFreeze } from "./executor/executor";
import { VersionStore } from "./history/versions";
import { RunLog } from "./history/runlog";
import { createFsHandle, FS_DESCRIPTION, FS_TYPES } from "./builtins/fs";
import { createStdBindings, STD_DESCRIPTION, STD_TYPES } from "./builtins/std";
import { buildTools } from "./tools/verbs";
import { executeRun } from "./tools/run";

export interface WorkingEnvironment {
  /** The model-facing verb set — fold these onto an agent (or use mountWorkingEnvironment). */
  tools: EnvTool[];
  /** The same verbs with a name prefix, for hosts that need collision-free names. */
  toolsWithPrefix(prefix: string): EnvTool[];
  /** Host-side guarded filesystem handle (same rules as the model verbs). */
  fs: EnvFsHandle;
  limits: EnvLimits;
  /** `env:*` module name → one-line description (builtins + registered adapters). */
  moduleDescriptions: ReadonlyMap<string, string>;
  /** Host-side script execution (full result, no truncation; still logged to history). */
  runScript(path: string, args?: unknown): Promise<RunResult>;
  /** Door in: place a host file (path), bytes, or literal text into the tree. */
  mount(source: string | Uint8Array | { text: string }, dest: string): Promise<void>;
  /** Door out: collect files matching a glob, e.g. `/out/**`. */
  export(pattern: string): Promise<Array<{ path: string; bytes: Uint8Array }>>;
  /** Serialize the whole environment (files, scripts, .d.ts siblings, history). */
  snapshot(): Promise<EnvSnapshot>;
}

const ADAPTER_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const CONVENTIONAL_DIRS = ["/inbox", "/scripts", "/scripts/lib", "/std", "/tmp", "/out", "/.env"];

export async function createWorkingEnvironment(options: CreateWorkingEnvironmentOptions = {}): Promise<WorkingEnvironment> {
  const vfs = options.filesystem ?? inMemoryFs();
  const limits: EnvLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const versions = new VersionStore(vfs, limits);
  const runlog = new RunLog(vfs, limits);
  const core = new EnvCore(vfs, limits, versions);
  const executor = new ScriptExecutor({
    readSource: core.readSource,
    envModules: () => core.envModules,
    isEnforcedScript: (p) => core.isEnforcedScript(p),
    limits,
  });
  core.attachExecutor(executor);
  const fsHandle = createFsHandle(core);

  // --- register env:* modules (builtins first, then adapters) -------------
  const register = (name: string, description: string, bindings: Record<string, unknown>) => {
    if (!ADAPTER_NAME_RE.test(name)) {
      throw new Error(`invalid stdlib adapter name "${name}" — use lowercase letters, digits, _ or -`);
    }
    if (core.envModules.has(name)) throw new Error(`stdlib adapter name "${name}" is already registered`);
    const ns: Record<string, unknown> = { ...bindings };
    ns.default = ns; // `import fs from 'env:fs'` gives the whole module
    core.envModules.set(name, deepFreeze(ns));
    core.moduleDescriptions.set(name, description);
  };

  register("fs", FS_DESCRIPTION, createFsHandle(core) as unknown as Record<string, unknown>);
  register("std", STD_DESCRIPTION, createStdBindings());
  const adapters: StdlibAdapter[] = options.stdlib ?? [];
  for (const adapter of adapters) {
    register(adapter.name, adapter.description, adapter.create(fsHandle));
  }

  // --- materialize the tree ----------------------------------------------
  for (const d of CONVENTIONAL_DIRS) await vfs.mkdir(d);
  if (await vfs.exists("/std")) await vfs.rm("/std"); // drop stale docs from a restored snapshot
  await vfs.mkdir("/std");
  const writeDoc = (p: string, content: string) => vfs.write(p, toBytes(content));
  await writeDoc("/std/fs/index.d.ts", FS_TYPES);
  await writeDoc("/std/std/index.d.ts", STD_TYPES);
  for (const adapter of adapters) {
    await writeDoc(`/std/${adapter.name}/index.d.ts`, adapter.types);
    if (adapter.docs) await writeDoc(`/std/${adapter.name}/README.md`, adapter.docs);
  }

  const tools = buildTools({ core, runlog, limits, prefix: "" });

  return {
    tools,
    toolsWithPrefix: (prefix: string) => buildTools({ core, runlog, limits, prefix }),
    fs: fsHandle,
    limits,
    moduleDescriptions: core.moduleDescriptions,

    async runScript(path: string, args: unknown = {}): Promise<RunResult> {
      const outcome = await executeRun({ core, runlog, limits, executor }, path, args, { spill: false });
      return outcome.run;
    },

    async mount(source: string | Uint8Array | { text: string }, dest: string): Promise<void> {
      const p = normalizePath(dest);
      if (isUnder(p, "/.env") || isUnder(p, "/std")) {
        throw new Error(`cannot mount into ${p}: /.env and /std are maintained by the environment`);
      }
      const data =
        typeof source === "string"
          ? new Uint8Array(await hostReadFile(source))
          : source instanceof Uint8Array
            ? source
            : toBytes(source.text);
      if (data.byteLength > limits.maxFileBytes) {
        throw new EnvLimitError(
          `file size limit exceeded: mounting ${p} at ${data.byteLength} bytes, over the ${limits.maxFileBytes}-byte cap (limits.maxFileBytes)`,
        );
      }
      const total = await vfs.totalSize();
      if (total + data.byteLength > limits.maxVfsBytes) {
        throw new EnvLimitError(
          `environment size limit exceeded: mounting ${p} would grow the tree past ${limits.maxVfsBytes} bytes (limits.maxVfsBytes)`,
        );
      }
      await vfs.write(p, data);
    },

    async export(pattern: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
      const paths = await core.glob(pattern);
      const out: Array<{ path: string; bytes: Uint8Array }> = [];
      for (const p of paths) out.push({ path: p, bytes: await vfs.read(p) });
      return out;
    },

    async snapshot(): Promise<EnvSnapshot> {
      return snapshotVfs(vfs);
    },
  };
}

async function snapshotVfs(vfs: Vfs): Promise<EnvSnapshot> {
  if (vfs instanceof InMemoryFs) return vfs.toSnapshot();
  const dirs: string[] = [];
  const files: EnvSnapshot["files"] = [];
  const walk = async (dir: string): Promise<void> => {
    dirs.push(dir);
    for (const e of await vfs.list(dir)) {
      const p = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
      if (e.kind === "dir") {
        await walk(p);
      } else {
        const stat = await vfs.stat(p);
        files.push({ path: p, data: bytesToBase64(await vfs.read(p)), mtime: stat?.mtime ?? 0 });
      }
    }
  };
  await walk("/");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { version: 1, dirs: dirs.sort(), files };
}

// ---------------------------------------------------------------- exports

export { inMemoryFs, fromSnapshot, InMemoryFs } from "./vfs/memory";
export { mountWorkingEnvironment, buildPreamble, type MountWorkingEnvironmentConfig } from "./tools/mount";
export { defaultExportError, ScriptContractError } from "./pipeline/contract";
export { deepFreeze } from "./executor/executor";
export { normalizePath, globToRegExp } from "./paths";
export {
  DEFAULT_LIMITS,
  EnvLimitError,
  type CreateWorkingEnvironmentOptions,
  type EnvFsHandle,
  type EnvLimits,
  type EnvSnapshot,
  type EnvTool,
  type EnvToolResult,
  type FileVersionInfo,
  type MountableAgent,
  type RunResult,
  type StdlibAdapter,
  type Vfs,
  type VfsEntry,
  type VfsStat,
} from "./types";
