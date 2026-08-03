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
import { tagBindings } from "./adapters/tag";
import { createFsHandle, createReadOnlyFsHandle, FS_DESCRIPTION, FS_TYPES } from "./builtins/fs";
import { createStdBindings, STD_DESCRIPTION, STD_TYPES } from "./builtins/std";
import { ASSERT_DESCRIPTION, ASSERT_TYPES, createAssertBindings } from "./builtins/assert";
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
  /**
   * Problems found at startup that are not fatal — today, stored scripts
   * importing modules this host did not register. Empty for a fresh
   * environment. Pass `strictAdapters: true` to make them throw instead.
   */
  warnings: string[];
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
    envModules: (readOnly: boolean) => (readOnly ? core.envModulesReadOnly : core.envModules),
    isEnforcedScript: (p) => core.isEnforcedScript(p),
    limits,
  });
  core.attachExecutor(executor);
  const fsHandle = createFsHandle(core);

  // --- register env:* modules (builtins first, then adapters) -------------
  // Two parallel sets: the normal one, and a validation-time one bound to a
  // filesystem that refuses mutations. Write-time validation executes module
  // top-level code, and a rejected write must leave no trace — including
  // through an adapter that writes.
  const readOnlyFsHandle = createReadOnlyFsHandle(core);
  const register = (
    name: string,
    description: string,
    bindings: Record<string, unknown>,
    readOnlyBindings: Record<string, unknown>,
  ) => {
    if (!ADAPTER_NAME_RE.test(name)) {
      throw new Error(`invalid stdlib adapter name "${name}" — use lowercase letters, digits, _ or -`);
    }
    if (core.envModules.has(name)) throw new Error(`stdlib adapter name "${name}" is already registered`);
    const seal = (b: Record<string, unknown>) => {
      // Tag first: a failure inside a capability should name the capability,
      // not arrive as a bare message from four possible sources.
      const ns: Record<string, unknown> = tagBindings(name, b);
      ns.default = ns; // `import fs from 'env:fs'` gives the whole module
      return deepFreeze(ns);
    };
    core.envModules.set(name, seal(bindings));
    core.envModulesReadOnly.set(name, seal(readOnlyBindings));
    core.moduleDescriptions.set(name, description);
  };

  register(
    "fs",
    FS_DESCRIPTION,
    fsHandle as unknown as Record<string, unknown>,
    readOnlyFsHandle as unknown as Record<string, unknown>,
  );
  register("std", STD_DESCRIPTION, createStdBindings(), createStdBindings());
  register("assert", ASSERT_DESCRIPTION, createAssertBindings(), createAssertBindings());
  const adapters: StdlibAdapter[] = options.stdlib ?? [];
  for (const adapter of adapters) {
    const instantiate = (vfs: EnvFsHandle, readOnly: boolean) => {
      const produced = adapter.create(vfs, { name: adapter.name, readOnly });
      if (!produced || typeof produced !== "object") {
        throw new TypeError(
          `stdlib adapter "${adapter.name}": create() must return an object of bindings, got ${
            produced === null ? "null" : typeof produced
          }`,
        );
      }
      return produced;
    };
    const bindings = instantiate(fsHandle, false);
    register(adapter.name, adapter.description, bindings, instantiate(readOnlyFsHandle, true));
    if (adapter.handles) {
      // The registry holds the read-WRITE describe: `describe` is a read-only
      // verb by nature, but an adapter that needs a scratch file to answer
      // (rasterizing a page, say) must not be blocked by the validation-time
      // handle. Registered from `core.envModules` so the binding is the same
      // tagged, frozen one scripts call.
      const ns = core.envModules.get(adapter.name) ?? {};
      const describe = typeof ns.describe === "function" ? (ns.describe as (p: string) => Promise<unknown>) : undefined;
      core.handlers.register({ module: adapter.name, handles: adapter.handles, describe });
    }
  }

  // --- materialize the tree ----------------------------------------------
  for (const d of CONVENTIONAL_DIRS) await vfs.mkdir(d);
  if (await vfs.exists("/std")) await vfs.rm("/std"); // drop stale docs from a restored snapshot
  await vfs.mkdir("/std");
  const writeDoc = (p: string, content: string) => vfs.write(p, toBytes(content));
  await writeDoc("/std/fs/index.d.ts", FS_TYPES);
  await writeDoc("/std/std/index.d.ts", STD_TYPES);
  await writeDoc("/std/assert/index.d.ts", ASSERT_TYPES);
  for (const adapter of adapters) {
    await writeDoc(`/std/${adapter.name}/index.d.ts`, adapter.types);
    if (adapter.docs) await writeDoc(`/std/${adapter.name}/README.md`, adapter.docs);
  }
  // --- restore-time compatibility -----------------------------------------
  // A restored tree looks healthy whether or not the host registered the same
  // adapters: /scripts is intact, ls shows the catalogue, and the .d.ts files
  // describe capabilities that no longer exist. Without this the break
  // surfaces mid-task, to the model, instead of at startup, to the host.
  //
  // Read from the tree rather than from snapshot metadata: no format version
  // to bump, no v1 compatibility question, and it works for a host-supplied
  // persistent filesystem that never passed through snapshot() at all.
  const warnings: string[] = [];
  const usage = await core.moduleUsage();
  const missing = [...usage.entries()].filter(([name]) => !core.envModules.has(name));
  if (missing.length > 0) {
    for (const [name, scripts] of missing) {
      const shown = scripts.slice(0, 5).join(", ");
      const more = scripts.length > 5 ? `, +${scripts.length - 5} more` : "";
      warnings.push(
        `stored scripts import "env:${name}", which is not registered in this environment — they will fail when run: ${shown}${more}`,
      );
    }
    if (options.strictAdapters) throw new Error(warnings.join("\n"));
  }

  // Written after the scan so the index can say which modules the stored
  // scripts actually use — on a restored tree that is the difference between
  // a menu and a map.
  await writeDoc("/std/README.md", stdIndex(core.moduleDescriptions, adapters, usage));

  core.attachRunLog(runlog);

  const tools = buildTools({ core, runlog, limits, prefix: "" });

  return {
    tools,
    toolsWithPrefix: (prefix: string) => buildTools({ core, runlog, limits, prefix }),
    fs: fsHandle,
    limits,
    moduleDescriptions: core.moduleDescriptions,
    warnings,

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

/**
 * `/std/README.md` — the one file that answers "what can I import?". Without
 * it a model has to `ls /std`, then open each `index.d.ts` to find out what
 * the module is even for.
 */
function stdIndex(
  descriptions: ReadonlyMap<string, string>,
  adapters: StdlibAdapter[],
  usage: ReadonlyMap<string, string[]>,
): string {
  const lines = [
    "# /std — importable modules",
    "",
    "Everything here is available to scripts under `/scripts` via `import ... from 'env:<name>'`.",
    "This directory is read-only and regenerated on startup.",
    "",
    "| Module | What it does | Types | Used by |",
    "|---|---|---|---|",
  ];
  for (const [name, description] of descriptions) {
    const n = usage.get(name)?.length ?? 0;
    const used = n === 0 ? "–" : `${n} script(s)`;
    lines.push(`| \`env:${name}\` | ${description.replace(/\|/g, "\\|")} | \`/std/${name}/index.d.ts\` | ${used} |`);
  }
  const withDocs = adapters.filter((a) => a.docs);
  if (withDocs.length > 0) {
    lines.push("", "Worked examples:", "");
    for (const a of withDocs) lines.push(`- \`/std/${a.name}/README.md\``);
  }
  lines.push(
    "",
    "Read the `.d.ts` before calling into a module — it is the contract, and it is",
    "cheaper than a failed run. Adapter functions take and return VFS paths:",
    "pass a path in, get a path out, and inspect the result with `read_file` or",
    "the module's own `describe(path)`.",
    "",
  );
  return lines.join("\n");
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
export { hostDirectory, HostDirectoryFs, type HostDirectoryOptions } from "./vfs/hostdir";
export {
  defineAdapter,
  type AdapterBindings,
  type AdapterContext,
  type AdapterSpec,
  type DefinedAdapter,
  type FileSummary,
} from "./adapters/define";
export { HandlerRegistry, type Claim, type HandlesSpec, type RegisteredHandler } from "./adapters/handles";
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
