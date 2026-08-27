/**
 * glove-working-environment — a small, fast, in-memory, sandboxed
 * persistent working environment for LLM agents.
 *
 * One tree: inputs, scripts, intermediates, outputs, docs, and history all
 * live in a persistent, snapshottable virtual filesystem. Scripts execute
 * in a scope containing only injected capabilities — no networking, no
 * host filesystem access, no process spawning, by construction.
 */
import { ASKING, BUILTIN_SKILLS, DELIVERING, skillsIndex } from "./skills";
import { readFile as hostReadFile } from "node:fs/promises";
import {
  DEFAULT_LIMITS,
  toBytes,
  toText,
  EnvLimitError,
  type CreateWorkingEnvironmentOptions,
  type EnvCounters,
  type EnvFsHandle,
  type EnvLimits,
  type EnvSnapshot,
  type EnvTool,
  type RunResult,
  type StdlibAdapter,
  type Vfs,
} from "./types";
import { isUnder, normalizePath } from "glove-vfs";
import { InMemoryFs, bytesToBase64, inMemoryFs } from "glove-vfs";
import { EnvCore } from "./core/env";
import { deepFreeze } from "./executor/executor";
import { WorkerPool } from "./executor/pool";
import { VersionStore } from "./history/versions";
import { RunLog } from "./history/runlog";
import { tagBindings } from "./adapters/tag";
import { primePureModule, pureStateOf } from "./adapters/pure";
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
   * Live counters for a dashboard: limit hits, spillovers, mutations.
   *
   * Read them on a schedule; the object is the environment's own, not a copy,
   * so there is nothing to subscribe to and nothing to leak.
   */
  counters: EnvCounters;
  /**
   * Problems found at startup that are not fatal — today, stored scripts
   * importing modules this host did not register. Empty for a fresh
   * environment. Pass `strictAdapters: true` to make them throw instead.
   */
  warnings: string[];
  /**
   * Host-side script execution (full result, no truncation; still logged to
   * history).
   *
   * `timeoutMs` budgets this run alone and is clamped to
   * `limits.runTimeoutMs` — it can ask for less than the environment allows,
   * never more. `signal` cancels this run and nothing else: the worker is
   * terminated, the run resolves with a cancellation error, and the
   * environment stays usable. Anything the cancelled run had already handed
   * to the host is refused rather than committed.
   */
  runScript(path: string, args?: unknown, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<RunResult>;
  /** Door in: place a host file (path), bytes, or literal text into the tree. */
  mount(source: string | Uint8Array | { text: string }, dest: string): Promise<void>;
  /** Door out: collect files matching a glob, e.g. `/out/**`. */
  export(pattern: string): Promise<Array<{ path: string; bytes: Uint8Array }>>;
  /** Serialize the whole environment (files, scripts, .d.ts siblings, history). */
  snapshot(): Promise<EnvSnapshot>;
  /**
   * Start the worker pool now, in the background, instead of on first use.
   *
   * The first script of a session — run OR written, since write-time
   * validation runs in a worker too — otherwise carries ~82 ms of thread
   * start-up. Call this at a moment the host is already waiting: after
   * restoring a snapshot, while the first model turn is in flight.
   *
   * Never rejects. A spawn that fails leaves the pool exactly as it was and is
   * retried on demand, with the pool's own backoff and named errors. Equivalent
   * to `execution: { prewarm: true }`, at a moment of your choosing.
   */
  warmup(): Promise<void>;
  /**
   * Release the environment's worker threads.
   *
   * Call it when a session ends. Workers are `unref`'d so they never hold the
   * process open, and one that has been idle for `execution.idleTimeoutMs`
   * (default 60s) is reaped on its own — but the tree, the version rings and
   * the adapters are only released here. A long-lived host holding hundreds of
   * sessions should close them on idle and resume from a snapshot — see
   * LIFECYCLE.md.
   *
   * A run still in flight is given `graceMs` (default 5s) to reach its own
   * end before its worker is terminated, so a script part-way through writing
   * its outputs can finish the file rather than leave half of one behind.
   * Past that it is terminated and its `runScript` resolves with an error
   * saying the environment was closed — never left hanging.
   */
  close(options?: { graceMs?: number }): Promise<void>;
}

const ADAPTER_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const CONVENTIONAL_DIRS = ["/inbox", "/scripts", "/scripts/lib", "/skills", "/std", "/tmp", "/out", "/.env"];

export async function createWorkingEnvironment(options: CreateWorkingEnvironmentOptions = {}): Promise<WorkingEnvironment> {
  const vfs = options.filesystem ?? inMemoryFs();
  const limits: EnvLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const versions = new VersionStore(vfs, limits);
  const runlog = new RunLog(vfs, limits);
  // Host-configured read-only zones, validated eagerly: a bad path should
  // fail here, to the host, not as a confusing refusal to the model later.
  const readOnlyZones = [...new Set((options.readOnlyPaths ?? []).map((raw) => {
    if (typeof raw !== "string" || !raw.startsWith("/")) {
      throw new Error(`readOnlyPaths entries must be absolute VFS paths, got ${JSON.stringify(raw)}`);
    }
    const zone = normalizePath(raw);
    if (zone === "/") {
      throw new Error(
        "readOnlyPaths cannot contain \"/\" — an environment the agent cannot write to at all has no reason to exist. " +
          "Use hostDirectory(dir, { mode: \"readonly\" }) if you want a fully read-only tree.",
      );
    }
    return zone;
  }))];
  const core = new EnvCore(vfs, limits, versions, options.nudgeToDocsOnFirstWrite ?? false, readOnlyZones);
  // Scripts run in a supervised worker pool, not on the host event loop. A
  // compute-bound script is terminable there and nowhere else — see
  // executor/pool.ts for the measurement that forced this.
  // Pure modules the worker must import locally rather than RPC. Filled
  // during registration below; read lazily by the pool when it spawns.
  const pureList: Array<{ name: string; url: string; pick: string[] }> = [];
  // The read-only twins are built on first use, not at create — see
  // `readOnlyBuilders` below. Everything that reads them goes through here, so
  // there is one place that has to remember to materialize them.
  const readOnlyBuilders: Array<() => void> = [];
  let readOnlyBuilt = false;
  const readOnlyModules = (): Map<string, Record<string, unknown>> => {
    if (!readOnlyBuilt) {
      readOnlyBuilt = true;
      for (const build of readOnlyBuilders) build();
    }
    return core.envModulesReadOnly;
  };
  const executor = new WorkerPool(
    {
      readSource: core.readSource,
      envModules: (readOnly: boolean) => (readOnly ? readOnlyModules() : core.envModules),
      pureModules: () => pureList,
      limits,
    },
    options.execution,
  );
  core.attachExecutor(executor);
  const fsHandle = createFsHandle(core);

  // --- register env:* modules (builtins first, then adapters) -------------
  // Two parallel sets: the normal one, and a validation-time one bound to a
  // filesystem that refuses mutations. Write-time validation executes module
  // top-level code, and a rejected write must leave no trace — including
  // through an adapter that writes.
  //
  // The validation-time set is built on FIRST USE. Measured on a create with
  // the four format adapters registered: instantiating the read-only twins is
  // ~4 ms of a 15.6 ms create, spent on an object a host that only mounts
  // files and takes a snapshot never touches. A host that does run scripts
  // pays it at the first worker spawn instead — which `execution.prewarm`
  // moves off the request path entirely. See #129.
  const readOnlyFsHandle = createReadOnlyFsHandle(core);
  const register = (
    name: string,
    description: string,
    bindings: Record<string, unknown>,
    readOnlyBindings: Record<string, unknown> | (() => Record<string, unknown>),
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
    // Deferred in registration order, so the read-only map ends up iterating
    // in the same order as the read-write one — the pool describes both into
    // one `start` message and a divergence there would be a nightmare to find.
    if (typeof readOnlyBindings === "function") {
      readOnlyBuilders.push(() => core.envModulesReadOnly.set(name, seal(readOnlyBindings())));
    } else {
      core.envModulesReadOnly.set(name, seal(readOnlyBindings));
    }
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
    // A pure module never touches the VFS and its bindings are host-imported,
    // not created against a handle — so it skips the instantiate machinery
    // entirely. The host import here doubles as validation: a bad `from` or a
    // guessed pick fails NOW, with a message naming the fix, rather than as
    // an `undefined` inside somebody's script.
    if (pureStateOf(adapter)) {
      const primed = await primePureModule(adapter);
      const bindings = adapter.create(fsHandle, { name: adapter.name, readOnly: false });
      register(adapter.name, adapter.description, bindings, bindings);
      pureList.push(primed);
      continue;
    }
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
    // The read-WRITE instantiation above still runs eagerly, so `create()`
    // returning a non-object — and anything an adapter's factory throws for
    // reasons unrelated to `ctx.readOnly` — still fails at create, where the
    // host sees it. What moves is the case an adapter can only hit on the
    // read-only path: that now surfaces at the first validation (or the first
    // prewarm), so it is re-labelled here to keep naming the adapter and to
    // say which of its two instantiations failed. A throw that far from
    // `createWorkingEnvironment` is otherwise very hard to place.
    register(adapter.name, adapter.description, bindings, () => {
      try {
        return instantiate(readOnlyFsHandle, true);
      } catch (e) {
        throw new Error(
          `stdlib adapter "${adapter.name}": create() failed while building its validation-time ` +
            `(read-only) bindings — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
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
    if (adapter.renders) {
      // Same read-WRITE binding as describe, and for a stronger reason:
      // rasterizing has to put page images somewhere.
      const ns = core.envModules.get(adapter.name) ?? {};
      const render = ns.render;
      if (typeof render !== "function") {
        throw new TypeError(
          `stdlib adapter "${adapter.name}" declares renders but exposes no render() binding — ` +
            `create() must return { render(input, outDir, opts?) }`,
        );
      }
      core.handlers.registerRenderer({
        module: adapter.name,
        renders: adapter.renders,
        render: render as (input: string, outDir: string, opts?: unknown) => Promise<unknown>,
      });
    }
  }

  // Recorded after registration (which is what rejects a duplicate name) and
  // in one place, so a pure module — whose branch above skips the instantiate
  // machinery entirely — is versioned like any other adapter.
  for (const adapter of adapters) {
    if (adapter.version) core.moduleVersions.set(adapter.name, adapter.version);
  }

  // --- materialize the tree ----------------------------------------------
  for (const d of CONVENTIONAL_DIRS) await vfs.mkdir(d);
  // Read-only zones are created up front (raw vfs — the guard would refuse a
  // mkdir later) so they show up in ls and the host can mount into them.
  for (const zone of readOnlyZones) await vfs.mkdir(zone);
  const writeDoc = (p: string, content: string) => writeIfChanged(vfs, p, toBytes(content));
  const stdDocs = new Map<string, string>([
    ["/std/fs/index.d.ts", FS_TYPES],
    ["/std/std/index.d.ts", STD_TYPES],
    ["/std/assert/index.d.ts", ASSERT_TYPES],
  ]);
  for (const adapter of adapters) {
    stdDocs.set(`/std/${adapter.name}/index.d.ts`, adapter.types);
    if (adapter.docs) stdDocs.set(`/std/${adapter.name}/README.md`, adapter.docs);
  }
  // `/std/README.md` is written further down — it names which modules the
  // stored scripts import, so it needs the usage scan first — but it has to be
  // declared as wanted HERE, or the sweep reads it as a leftover and wipes the
  // directory it is about to be rewritten into. That would make every restore
  // take the slow path, which is the one this exists to avoid.
  await sweepGenerated(vfs, "/std", new Set([...stdDocs.keys(), "/std/README.md"]));
  for (const [path, content] of stdDocs) await writeDoc(path, content);

  // --- skills -------------------------------------------------------------
  // /std is reference; /skills is worked recipes. The measured friction says
  // models reach for a remembered shape rather than a signature, so the fix
  // is a correct example in front of them, not a better error afterwards.
  const skills = [
    ...BUILTIN_SKILLS,
    ...(options.onPresent ? [DELIVERING] : []),
    ...(options.onAsk ? [ASKING] : []),
    ...adapters.flatMap((a) => a.skills ?? []),
  ];
  const skillDocs = new Map<string, string>(skills.map((s) => [`/skills/${s.name}.md`, s.body]));
  skillDocs.set("/skills/README.md", skillsIndex(skills));
  await sweepGenerated(vfs, "/skills", new Set(skillDocs.keys()));
  for (const [path, content] of skillDocs) await writeDoc(path, content);
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

  // The other half of the same problem, and the half nothing could see. A
  // missing module is caught above; a renamed binding fails at the next run
  // with its own name in the error. A binding whose SIGNATURE changed under
  // the same name is invisible at every layer — the import resolves, the
  // call is made, and the failure lands somewhere inside the adapter.
  //
  // Same reasoning as the scan above: the record lives in the tree rather
  // than in snapshot metadata, so it works for a host-supplied persistent
  // filesystem and needs no EnvSnapshot format bump.
  //
  // Deliberately NOT covered by `strictAdapters`, which is about a capability
  // that is simply gone. Restoring across a version bump is the normal case —
  // the host upgraded a dependency — and a startup throw would make every
  // upgrade a data-loss event. It is a warning to the host and, more to the
  // point, a warning to the model in orientation.
  const skew = await compareAdapterVersions(vfs, core.moduleVersions);
  core.adapterSkew.push(...skew);
  warnings.push(...skew);

  // Written after the scan so the index can say which modules the stored
  // scripts actually use — on a restored tree that is the difference between
  // a menu and a map.
  await writeDoc("/std/README.md", stdIndex(core.moduleDescriptions, adapters, usage, core.moduleVersions));

  core.attachRunLog(runlog);

  // Captured out here: `close(options?)` shadows the outer `options`, and a
  // warning that silently went nowhere would be worse than none.
  const warn = options.execution?.onWarning ?? ((m: string) => console.warn(m));

  // Deliberately not awaited: the point is that the caller gets its
  // environment back and the thread starts underneath it. `warmup()` is
  // documented never to reject, so there is no floating rejection here — a
  // spawn that fails leaves the pool untouched for `acquire` to retry, with
  // the backoff and the named error that path already has.
  if (options.execution?.prewarm) void executor.warmup();

  const tools = buildTools({
    core,
    runlog,
    limits,
    prefix: "",
    vision: options.vision,
    onPresent: options.onPresent,
    onAsk: options.onAsk,
    onVerb: options.onVerb,
  });

  return {
    tools,
    toolsWithPrefix: (prefix: string) =>
      buildTools({
        core,
        runlog,
        limits,
        prefix,
        vision: options.vision,
        onPresent: options.onPresent,
        onAsk: options.onAsk,
        onVerb: options.onVerb,
      }),
    fs: fsHandle,
    limits,
    moduleDescriptions: core.moduleDescriptions,
    counters: core.counters,
    warnings,

    warmup: () => executor.warmup(),

    async runScript(
      path: string,
      args: unknown = {},
      opts?: { timeoutMs?: number; signal?: AbortSignal },
    ): Promise<RunResult> {
      const outcome = await executeRun({ core, runlog, limits, executor }, path, args, {
        spill: false,
        timeoutMs: opts?.timeoutMs,
        signal: opts?.signal,
      });
      return outcome.run;
    },

    async mount(source: string | Uint8Array | { text: string }, dest: string): Promise<void> {
      const p = normalizePath(dest);
      if (isUnder(p, "/.env") || isUnder(p, "/std")) {
        throw new Error(`cannot mount into ${p}: /.env and /std are maintained by the environment`);
      }
      // Deliberately NOT guarded by readOnlyPaths: mount is the host door,
      // and seeding content into a zone the agent can only read is exactly
      // what the option is for.
      //
      // Host I/O stays OUTSIDE the lock. Reading a file off the host disk can
      // take as long as the disk takes, and holding the environment's one
      // mutation queue for it would stall every concurrently running script.
      // Copied, not adopted. A host that mounts a buffer it goes on to reuse
      // — a pooled read buffer, a slice of a larger upload — would otherwise
      // be editing the tree in place, with no verb recorded, no version
      // taken, and no way for the model to see it happen.
      const data =
        typeof source === "string"
          ? new Uint8Array(await hostReadFile(source))
          : source instanceof Uint8Array
            ? new Uint8Array(source)
            : toBytes(source.text);
      if (data.byteLength > limits.maxFileBytes) {
        throw new EnvLimitError(
          `file size limit exceeded: mounting ${p} at ${data.byteLength} bytes, over the ${limits.maxFileBytes}-byte cap (limits.maxFileBytes)`,
        );
      }
      // The size check and the write are one transaction: apart, two mounts
      // (or a mount and a script's write) that each fit under the cap can
      // both pass and together exceed it.
      await core.exclusive(async () => {
        const total = await vfs.totalSize();
        if (total + data.byteLength > limits.maxVfsBytes) {
          throw new EnvLimitError(
            `environment size limit exceeded: mounting ${p} would grow the tree past ${limits.maxVfsBytes} bytes (limits.maxVfsBytes)`,
          );
        }
        await vfs.write(p, data);
      });
    },

    async export(pattern: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
      // Under the lock so the set of matched paths and their bytes describe
      // one moment: unlocked, a run deleting `/out/draft.pdf` between the glob
      // and the read makes the door throw on a file it just listed.
      return core.exclusive(async () => {
        const paths = await core.glob(pattern);
        const out: Array<{ path: string; bytes: Uint8Array }> = [];
        // Copies, for the same reason mount takes one: `InMemoryFs.read`
        // hands back the live buffer, and a host that writes into what it
        // exported would be editing the tree behind the model's back.
        for (const p of paths) out.push({ path: p, bytes: new Uint8Array(await vfs.read(p)) });
        return out;
      });
    },

    async snapshot(): Promise<EnvSnapshot> {
      // The durability door. Interleaved with a mutation it captured a tree
      // the environment was never in — a version index recording a write the
      // files do not have — or threw outright, when the version ring rotated
      // a blob out between the `list()` that named it and the `read()`.
      return core.exclusive(() => snapshotVfs(vfs));
    },

    async close(options?: { graceMs?: number }): Promise<void> {
      // Order matters. The grace exists so a run part-way through writing its
      // outputs can finish the file, and those writes come back through this
      // core — sealing it first would break exactly what the grace is for. By
      // the time the executor is down no script can be running, so any
      // mutation after this point is a host that did not notice it closed.
      await executor.close(options);

      // After the pool, never before: an in-flight run given its shutdown
      // grace may still be calling into an adapter, and disposing one out from
      // under it would turn a graceful close into a crash inside the script.
      for (const adapter of adapters) {
        if (!adapter.close) continue;
        try {
          await adapter.close();
        } catch (e) {
          // A host that has asked to close must not be left holding an
          // environment it cannot dispose of.
          const message = `stdlib adapter "${adapter.name}" failed to close: ${e instanceof Error ? e.message : String(e)}`;
          warn(message);
        }
      }
      core.close();
    },
  };
}

/** Where the tree records the adapter contract versions it was last used with. */
const ADAPTER_MANIFEST = "/.env/adapters.json";

/**
 * Compare the versions this host registers against the ones the tree was last
 * used with, then record the current set.
 *
 * Only names present on BOTH sides with differing values are reported. An
 * adapter that declares no version opts out — comparing a known version
 * against "unknown" produces a warning nobody can act on, and the point of
 * this file is that every line in it names something the reader can do.
 */
async function compareAdapterVersions(vfs: Vfs, current: ReadonlyMap<string, string>): Promise<string[]> {
  let previous: Record<string, string> = {};
  if (await vfs.exists(ADAPTER_MANIFEST)) {
    try {
      const parsed = JSON.parse(toText(await vfs.read(ADAPTER_MANIFEST))) as { modules?: Record<string, string> };
      if (parsed?.modules && typeof parsed.modules === "object") previous = parsed.modules;
    } catch {
      // A manifest we cannot read tells us nothing, and failing startup over a
      // corrupt advisory file would be worse than the skew it exists to catch.
      // The write below replaces it.
    }
  }

  const warnings: string[] = [];
  for (const [name, version] of current) {
    const was = previous[name];
    if (typeof was === "string" && was !== version) {
      warnings.push(
        `env:${name} has changed contract version since this tree was last used: ${was} → ${version}. ` +
          `Stored scripts were written against the older module; a binding whose signature moved will fail ` +
          `when they run. Re-read /std/${name}/index.d.ts before trusting a stored script that imports it.`,
      );
    }
  }

  // Written only when something declares a version, so an environment that
  // does not use the feature never pays a file for it — and an existing
  // record is left alone rather than erased by a host that happens to be
  // running unversioned adapters today.
  if (current.size > 0) {
    const modules: Record<string, string> = {};
    for (const name of [...current.keys()].sort()) modules[name] = current.get(name)!;
    await vfs.write(ADAPTER_MANIFEST, toBytes(`${JSON.stringify({ version: 1, modules }, null, 2)}\n`));
  }
  return warnings;
}

/**
 * Write only if the bytes on disk are not already the bytes we want.
 *
 * `/std` and `/skills` are regenerated on every create, and on a restore they
 * are regenerated to *exactly what the snapshot already holds*: 32 identical
 * writes for a host that mounted the four format adapters. On the in-memory
 * filesystem that is wasted work; on `hostDirectory` and `cachedRemote` it is
 * 32 real writes — and for `cachedRemote`, 32 network round trips — to change
 * nothing at all.
 *
 * The size check first is not an optimization for its own sake: a `.d.ts` that
 * has genuinely changed is usually a different length, and skipping the read
 * in that case is what keeps the comparison cheaper than the write it avoids.
 *
 * These writes go through the raw Vfs rather than the core gateway (the zones
 * would refuse them — /std is read-only to everyone else), so the byte budget
 * is unaffected either way: the tree ends at the same total, and no guarded
 * write happens between the sweep and the last of these.
 */
async function writeIfChanged(vfs: Vfs, path: string, bytes: Uint8Array): Promise<void> {
  const stat = await vfs.stat(path);
  if (stat?.kind === "file" && stat.size === bytes.byteLength) {
    const current = await vfs.read(path);
    let same = true;
    for (let i = 0; i < bytes.byteLength; i++) {
      if (current[i] !== bytes[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  await vfs.write(path, bytes);
}

/**
 * Make sure a generated directory holds nothing but `wanted`, then leave it.
 *
 * The recursive `rm` this replaces ran unconditionally, which meant a restored
 * snapshot lost `/std` and `/skills` and rebuilt them byte-for-byte. It is
 * still the right answer when there IS something stale — an adapter the host
 * dropped between sessions leaves a `/std/<name>/` describing a capability
 * that no longer exists, and a model reading it writes a script that cannot
 * run — so the wipe is kept, and merely made conditional on there being
 * something to wipe.
 *
 * Walks two levels because that is the whole shape of both trees (`/std/<mod>/
 * <file>`, `/skills/<file>`), rather than `vfs.files()`, which on a
 * host-directory tree walks the entire corpus to answer a question about
 * sixteen small files.
 */
async function sweepGenerated(vfs: Vfs, root: string, wanted: Set<string>): Promise<void> {
  const wantedDirs = new Set([root]);
  for (const p of wanted) wantedDirs.add(p.slice(0, p.lastIndexOf("/")));

  let stale = false;
  if (await vfs.exists(root)) {
    const sweep = async (dir: string, depth: number): Promise<void> => {
      for (const entry of await vfs.list(dir)) {
        const child = `${dir}/${entry.name}`;
        if (entry.kind === "file") {
          if (!wanted.has(child)) stale = true;
        } else if (!wantedDirs.has(child)) {
          // An empty leftover directory counts: `ls /std` would offer a module
          // that has no types behind it.
          stale = true;
        } else if (depth > 0) {
          await sweep(child, depth - 1);
        }
        if (stale) return;
      }
    };
    await sweep(root, 1);
    if (stale) await vfs.rm(root);
  }
  await vfs.mkdir(root); // idempotent; also covers the fresh-tree case
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
  versions: ReadonlyMap<string, string>,
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
    // The version rides in the module cell rather than in a column of its own:
    // most rows are builtins that have none, and an almost-empty column reads
    // as missing data instead of as "not applicable".
    const v = versions.get(name);
    lines.push(
      `| \`env:${name}\`${v ? ` (v${v})` : ""} | ${description.replace(/\|/g, "\\|")} | \`/std/${name}/index.d.ts\` | ${used} |`,
    );
  }
  if (versions.size > 0) {
    lines.push(
      "",
      "A `(v…)` is the module's binding-contract version. If this tree was restored",
      "from a session that used a different one, `/.env/orientation.md` says so and",
      "names the module — a stored script written against the older version may call",
      "a binding whose signature has since moved.",
    );
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

// The filesystem now comes from `glove-vfs`, which is what lets this
// environment share ONE tree with the memory resource store and the
// sandboxed REPLs instead of keeping a private one. Re-exported here so the
// surface is unchanged for anyone already importing it from this package —
// and so the composition helpers are discoverable from the same import.
export { inMemoryFs, fromSnapshot, InMemoryFs } from "glove-vfs";
export { hostDirectory, HostDirectoryFs, type HostDirectoryOptions } from "glove-vfs";
export {
  mountFs,
  withAccess,
  withMeta,
  hasMeta,
  hasSearch,
  type Access,
  type AccessPolicy,
  type Mount,
  type MetaVfs,
} from "glove-vfs";
export { defineTools, type DefineToolsSpec, type ToolFn, type ToolFnContext } from "./adapters/tools";
export { createSessionManager, type SessionManager, type SessionManagerOptions } from "./hosting";
export {
  cachedRemote,
  CachedRemoteFs,
  type CachedRemoteOptions,
  type ObjectStore,
  type RemoteObject,
} from "glove-vfs";
export {
  defineAdapter,
  type AdapterBindings,
  type AdapterContext,
  type AdapterSpec,
  type DefinedAdapter,
  type FileSummary,
} from "./adapters/define";
export { HandlerRegistry, type Claim, type HandlesSpec, type RegisteredHandler, type RegisteredRenderer } from "./adapters/handles";
export { definePureModule, type PureModuleSpec } from "./adapters/pure";
export {
  defineBuilder,
  defineBuilders,
  methodsOf,
  type BuilderMember,
  type DefineBuilderOptions,
  type DefineBuildersOptions,
  type Finish,
} from "./adapters/builder";
export { BUILTIN_SKILLS, DELIVERING, skillsIndex, type Skill } from "./skills";
export { mountWorkingEnvironment, buildPreamble, type MountWorkingEnvironmentConfig } from "./tools/mount";
export { defaultExportError, ScriptContractError } from "./pipeline/contract";
export { deepFreeze } from "./executor/executor";
export { normalizePath, globToRegExp } from "glove-vfs";
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
  type PresentedFile,
  type VisionAdapter,
  type VfsEntry,
  type VfsStat,
} from "./types";
