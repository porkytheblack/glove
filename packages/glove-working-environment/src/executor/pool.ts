/**
 * The host side of script execution: a supervised pool of worker threads.
 *
 * ## Why this exists
 *
 * Before this, `runTimeoutMs` was enforced three ways and all three missed the
 * same case. `vm.runInContext({ timeout })` covers only a synchronous
 * evaluation; a deadline race needs the event loop to turn; a per-capability
 * check needs the script to call something. A pure compute loop —
 * `for(;;){ await null; }`, which a model writes by accident — defeats all
 * three. Measured before this change: a script with a 3s timeout ran 60s, the
 * host's 100ms timer fired zero times for the whole period, and the run was
 * then recorded as successful. That is a host outage triggered by ordinary
 * model output.
 *
 * `worker.terminate()` is the only mechanism that stops a thread regardless of
 * what it is doing. Measured after: a tight `for(;;){}` with no `await` at all
 * is killed on the deadline while the host stays responsive.
 *
 * ## Shape, borrowed from Station
 *
 * `station-signal` spawns a child per run and kills it when the deadline
 * passes; `station-beacon` supervises long-lived children with a restart
 * policy, exponential backoff, and a healthy-uptime reset so a process that
 * ran fine for hours does not come back at the top of the curve. This pool is
 * the same idea at thread scale: workers are warm and reused, a terminated one
 * is replaced, and repeated spawn failures back off instead of spinning.
 *
 * ## What is preserved
 *
 * A fresh vm context per run, which is what `tests/sandbox.test.ts` pins. The
 * worker is only a terminable container; isolation still comes from the
 * context, so pooling does not weaken it. Between runs the worker holds no
 * script state — the executor builds a new `OpState`, and a worker that ran a
 * script which timed out is destroyed rather than reused.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { EnvLimitError, type EnvLimits } from "../types";
import type { ModuleContract } from "../pipeline/contract";
import { BUILDER, describeShape, type BuilderSpec, type HostToWorker, type NeedMessage, type ResultMessage, type ShapeNode, type WorkerToHost } from "./protocol";

export interface PoolDeps {
  readSource(path: string): Promise<string | null>;
  envModules(readOnly: boolean): Map<string, Record<string, unknown>>;
  /**
   * Pure modules the worker imports locally instead of RPC-ing. A getter
   * because they are registered after the pool is constructed, exactly like
   * `envModules`; read once when the first worker spawns.
   */
  pureModules?(): Array<{ name: string; url: string; pick: string[] }>;
  limits: EnvLimits;
}

export interface PoolOptions {
  /** Warm workers kept alive. Default 1 — raise it for concurrent runs. */
  size?: number;
  /**
   * Grace period after the deadline before the worker is destroyed.
   *
   * The worker's own deadline race usually resolves the run first and gives a
   * better message; this is the backstop for when it cannot, which is exactly
   * the compute-loop case.
   */
  graceMs?: number;
  /**
   * Ceiling on a worker's JS heap, in MB. Default 256.
   *
   * The other half of "one script cannot take the host down". Measured
   * without it: a script pushing arrays in a loop grew the host to 7.2 GiB of
   * RSS inside the default 30s budget — the timeout is no protection at all,
   * because the process dies long before the deadline, and an OOM kill takes
   * every other agent in it. With the ceiling, V8 kills only that worker and
   * the pool replaces it.
   */
  memoryMb?: number;
  /** Grace given to in-flight runs by {@link WorkerPool.close}. Default 5000. */
  shutdownGraceMs?: number;
  /**
   * Where to report a misconfigured host. Defaults to `console.warn`, and is
   * called at most once per pool.
   *
   * Warning by default is deliberate. The one thing reported here is a memory
   * ceiling that was silently not applied, which is not a preference — it is
   * a protection the operator believes they have and does not.
   */
  onWarning?: (message: string) => void;
}

const DEFAULT_SIZE = 1;
const DEFAULT_GRACE_MS = 250;
const DEFAULT_MEMORY_MB = 256;
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;

/**
 * Whether the default `console.warn` has already reported a heap ceiling that
 * V8 refused to apply. Module-scoped because the condition it describes is a
 * property of the process, identical for every pool in it.
 */
let warnedAboutHeapGlobally = false;

/** Backoff for repeated worker spawn failures — station-beacon's curve. */
const BACKOFF = { baseMs: 50, factor: 3, maxMs: 5_000 };

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF.maxMs, Math.round(BACKOFF.baseMs * Math.pow(BACKOFF.factor, Math.max(0, attempt))));
}

interface Slot {
  worker: Worker;
  /** Resolves when the worker has built its namespaces and is ready to run. */
  ready: Promise<void>;
  busy: boolean;
  /** Set when this worker must not be reused — it was terminated mid-run. */
  poisoned: boolean;
}

/**
 * Locate the worker entry for however this package is being loaded.
 *
 * Resolved by probing rather than assuming, because `import.meta.url` here is
 * not a fixed location: a bundler may inline this module into a shared chunk
 * at the package root while emitting the worker under its source path, so
 * "next to this file" is only sometimes right. Getting it wrong surfaces as a
 * spawn failure at the first script run, which is a poor place to find out.
 */
function workerEntry(): { url: URL; execArgv: string[] | undefined } {
  const here = fileURLToPath(import.meta.url);
  // Running from TypeScript source: a worker inherits tsx's transform but not
  // its resolver, so the .ts entry cannot resolve its own relative imports.
  // The shim registers the loader, then reaches the entry through a dynamic
  // import — which is not hoisted above the registration as a static one is.
  if (here.endsWith(".ts")) return { url: new URL("./worker-dev.mjs", import.meta.url), execArgv: undefined };

  for (const candidate of ["./worker.js", "./executor/worker.js", "../executor/worker.js"]) {
    const url = new URL(candidate, import.meta.url);
    if (existsSync(fileURLToPath(url))) return { url, execArgv: undefined };
  }
  throw new Error(
    `glove-working-environment: could not find the script worker entry next to ${here}. ` +
      `The package must ship executor/worker.js as its own file — it is spawned by URL, not imported.`,
  );
}

export class WorkerPool {
  private slots: Slot[] = [];
  private queue: Array<() => void> = [];
  private shapes: { readWrite: Record<string, ShapeNode>; readOnly: Record<string, ShapeNode> } | null = null;
  private spawnFailures = 0;
  private warnedAboutHeap = false;
  private closed = false;
  private seq = 0;

  constructor(
    private readonly deps: PoolDeps,
    private readonly options: PoolOptions = {},
  ) {}

  private get size(): number {
    return Math.max(1, this.options.size ?? DEFAULT_SIZE);
  }

  /**
   * Namespace shapes, computed once.
   *
   * Adapters are registered at construction and never change, so describing
   * them per run would be pure waste — and `describeShape` walks every
   * binding.
   */
  private shapeSet(): { readWrite: Record<string, ShapeNode>; readOnly: Record<string, ShapeNode> } {
    if (this.shapes) return this.shapes;
    // Pure modules are imported inside the worker, not mirrored as RPC stubs;
    // describing them here would deliver a second, async copy that shadows
    // the synchronous one.
    const pure = new Set((this.deps.pureModules?.() ?? []).map((p) => p.name));
    const describe = (readOnly: boolean): Record<string, ShapeNode> => {
      const out: Record<string, ShapeNode> = {};
      for (const [name, ns] of this.deps.envModules(readOnly)) {
        if (!pure.has(name)) out[name] = describeShape(ns);
      }
      return out;
    };
    this.shapes = { readWrite: describe(false), readOnly: describe(true) };
    return this.shapes;
  }

  private get memoryMb(): number {
    return Math.max(32, this.options.memoryMb ?? DEFAULT_MEMORY_MB);
  }

  /**
   * Verify the memory ceiling was actually applied, and say so when it wasn't.
   *
   * `resourceLimits` is not authoritative. A process-level
   * `--max-old-space-size` — from the command line or `NODE_OPTIONS` —
   * overrides it, and nothing reports the conflict: `worker.resourceLimits`
   * still reads back the requested value while the isolate runs with the
   * process figure. Measured: `memoryMb: 128` under
   * `NODE_OPTIONS=--max-old-space-size=8192` produced a worker with a
   * 8,240 MB heap, which let a script reach 7.6 GiB of host RSS.
   *
   * Silence there is the worst outcome, because the operator has every reason
   * to believe the ceiling is real. So this is checked empirically against
   * what V8 reports from inside the thread, with the fix in the message. It
   * is not fatal: a raised heap is a deliberate host choice, and refusing to
   * start over it would be worse than saying so.
   *
   * Reported once per *process*, not per pool. The condition is a property of
   * the process — one flag, affecting every worker it will ever start — so a
   * host that creates an environment per conversation, or a test suite that
   * creates thirty, would otherwise repeat the same unchanging sentence until
   * it reads as log noise rather than a finding. A host that routes warnings
   * per environment still gets its own copy, since a custom `onWarning` is
   * the caller asking to be told.
   */
  private checkHeapCeiling(actualMb: number): void {
    if (this.warnedAboutHeap) return;
    // Young generation and code range sit on top of the old-generation
    // figure, so the effective limit is legitimately larger than requested.
    const tolerated = this.memoryMb * 1.5 + 64;
    if (!Number.isFinite(actualMb) || actualMb <= tolerated) return;
    this.warnedAboutHeap = true;

    const custom = this.options.onWarning;
    if (!custom) {
      if (warnedAboutHeapGlobally) return;
      warnedAboutHeapGlobally = true;
    }
    (custom ?? ((m: string) => console.warn(m)))(
      `glove-working-environment: the ${this.memoryMb}MB script memory ceiling (execution.memoryMb) was not applied — ` +
        `V8 gave the worker ${Math.round(actualMb)}MB. A process-level --max-old-space-size (command line or NODE_OPTIONS) ` +
        `overrides per-worker resourceLimits, so a runaway script can exhaust the host instead of just its own thread. ` +
        `Either drop that flag, or raise it knowing it bounds every script in this process rather than each one.`,
    );
  }

  private spawn(): Slot {
    const { url, execArgv } = workerEntry();
    const worker = new Worker(url, {
      ...(execArgv ? { execArgv } : {}),
      // A script cannot reach process.env — the executor's sandbox already
      // guarantees that — but a worker inherits it by default and there is no
      // reason to carry the host's secrets into the thread that runs
      // model-written code.
      env: {},
      // Bounds the blast radius of an allocating script to this thread. V8
      // terminates the worker on breach and the pool replaces it, instead of
      // the host process being OOM-killed with every other agent inside it.
      //
      // stdout/stderr are deliberately left to Node's default, which forwards
      // them to the host's own stdio. Setting them to `true` hands over a
      // stream that nothing in this pool reads, and an unread worker stream
      // just accumulates: measured at 40 MB buffered and 312 MiB of host RSS
      // from a chatty worker. Script `console` output never comes through
      // here anyway — the executor's shim captures it inside the context —
      // so what remains is host diagnostics, which belong in host logs.
      resourceLimits: { maxOldGenerationSizeMb: this.memoryMb },
    });
    worker.unref();

    const slot: Slot = { worker, busy: false, poisoned: false, ready: Promise.resolve() };
    slot.ready = new Promise<void>((resolve, reject) => {
      const onMessage = (m: WorkerToHost): void => {
        if (m.type === "ready") {
          worker.off("message", onMessage);
          this.spawnFailures = 0;
          this.checkHeapCeiling(m.heapLimitMb);
          resolve();
        }
      };
      worker.on("message", onMessage);
      worker.once("error", (e) => reject(e));
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`worker exited with code ${code} before becoming ready`));
      });
    });

    worker.postMessage({
      type: "start",
      limits: this.deps.limits,
      shapes: this.shapeSet(),
      pure: this.deps.pureModules?.() ?? [],
    } satisfies HostToWorker);
    return slot;
  }

  /**
   * Take a free worker, spawning or waiting as needed.
   *
   * `overflow` lets a request past the pool size instead of queueing. It is
   * for re-entrant work: a running script that calls
   * `env:fs.writeFile('/scripts/x.js')` triggers write-time validation on the
   * host, which needs a worker — while the worker that made the call is still
   * busy waiting for it. Queueing there is a deadlock, and the extra worker
   * is short-lived and released as soon as the validation finishes.
   */
  private async acquire(overflow = false): Promise<Slot> {
    if (this.closed) throw new Error("the working environment has been closed");
    for (;;) {
      const free = this.slots.find((s) => !s.busy && !s.poisoned);
      if (free) {
        free.busy = true;
        await free.ready;
        return free;
      }
      if (overflow || this.slots.filter((s) => !s.poisoned).length < this.size) {
        try {
          const slot = this.spawn();
          this.slots.push(slot);
          slot.busy = true;
          await slot.ready;
          return slot;
        } catch (e) {
          this.spawnFailures += 1;
          const wait = backoffMs(this.spawnFailures - 1);
          if (this.spawnFailures > 5) {
            throw new Error(
              `could not start a script worker after ${this.spawnFailures} attempts: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
      // All busy — wait for one to be released.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
  }

  /**
   * Turn a worker-level failure into something that names the knob.
   *
   * V8's own out-of-memory message says "reaching memory limit", which reads
   * as a host defect. Every other limit in this environment names the option
   * that controls it, and this one is no different — it is a configured
   * ceiling doing its job.
   */
  private describeWorkerFailure(e: Error & { code?: string }): string {
    if (e.code === "ERR_WORKER_OUT_OF_MEMORY") {
      return (
        `script exceeded the memory limit: ${this.memoryMb}MB (execution.memoryMb) and was terminated. ` +
        `Process data in batches — read, write, release — instead of accumulating it all in memory.`
      );
    }
    return `script worker failed: ${e.message}`;
  }

  private release(slot: Slot): void {
    slot.busy = false;
    // A poisoned worker is destroyed rather than reused. So is a surplus one:
    // `acquire(overflow)` deliberately spawns past the pool size to break the
    // re-entrant-validation deadlock, and without this the pool would keep
    // every worker that peak nesting ever needed, permanently.
    const surplus = !slot.poisoned && this.slots.filter((s) => !s.poisoned).length > this.size;
    if (slot.poisoned || surplus) {
      this.slots = this.slots.filter((s) => s !== slot);
      void slot.worker.terminate();
    }
    const next = this.queue.shift();
    if (next) next();
  }

  /** Serve one `need` from the worker. */
  private async serve(slot: Slot, message: NeedMessage): Promise<void> {
    const post = (payload: HostToWorker): void => slot.worker.postMessage(payload);
    const label = message.what === "capability" ? `env:${message.module}.${(message.route ?? []).join(".")}` : message.what;

    const respond = (ok: boolean, value?: unknown, error?: Error): void => {
      if (slot.poisoned) return; // terminated mid-flight; nothing to reply to
      try {
        post({
          type: "reply",
          id: message.id,
          ok,
          value,
          ...(error ? { error: { message: error.message, name: error.name } } : {}),
        });
      } catch (e) {
        // Two very different failures land here and they must not be
        // conflated. A DataCloneError means the VALUE cannot cross the thread
        // — the call is answerable, its result is not. Swallowing it leaves
        // the worker waiting on a reply that never comes, which surfaces as a
        // wall-clock timeout minutes later with nothing pointing at the cause.
        try {
          post({
            type: "reply",
            id: message.id,
            ok: false,
            error: {
              name: "TypeError",
              message:
                `${label} returned a value that cannot cross into a script: ` +
                `${e instanceof Error ? e.message : String(e)}. ` +
                `Capabilities must return data — paths, plain objects, arrays, bytes — not functions, ` +
                `class instances with behaviour, or anything holding a live host reference.`,
            },
          });
        } catch {
          // Now the worker really is gone; whoever terminated it is failing
          // the run already.
        }
      }
    };

    try {
      if (message.what === "readSource") {
        respond(true, await this.deps.readSource(message.path!));
        return;
      }
      if (message.what === "builder") {
        // Addressed by FAMILY, not by binding name: one recording can mix
        // constructors (`new Document({ children: [new Paragraph(...)] })`),
        // and it is the family that knows how to replay all of them.
        const ns = this.deps.envModules(message.readOnly === true).get(message.module!);
        let spec: BuilderSpec | undefined;
        for (const value of Object.values((ns ?? {}) as Record<string, unknown>)) {
          const candidate = (value as { [k: symbol]: BuilderSpec } | null | undefined)?.[BUILDER];
          if (candidate?.family === message.builder) {
            spec = candidate;
            break;
          }
        }
        if (!spec) throw new Error(`env:${message.module} has no builder family "${message.builder}"`);
        respond(true, await spec.replay(message.ops ?? []));
        return;
      }
      if (message.what === "capability") {
        const ns = this.deps.envModules(message.readOnly === true).get(message.module!);
        if (!ns) throw new Error(`no such module: env:${message.module}`);
        let target: unknown = ns;
        for (const key of message.route ?? []) {
          target = (target as Record<string, unknown>)?.[key];
        }
        if (typeof target !== "function") {
          throw new TypeError(`env:${message.module}.${(message.route ?? []).join(".")} is not callable`);
        }
        // Re-resolve `this` to the object the function hangs off, so a binding
        // written as a method keeps working.
        let owner: unknown = ns;
        const route = message.route ?? [];
        for (const key of route.slice(0, -1)) owner = (owner as Record<string, unknown>)?.[key];
        const result = await (target as (...a: unknown[]) => unknown).apply(owner, message.args ?? []);
        respond(true, result);
        return;
      }
      respond(false, undefined, new Error(`unknown host call: ${String(message.what)}`));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      respond(false, undefined, err);
    }
  }

  /**
   * Run or load a module in a worker, enforcing the deadline absolutely.
   */
  async execute(request: {
    mode: "run" | "load";
    path: string;
    args?: unknown;
    readOnly: boolean;
    overlay?: Map<string, string>;
  }): Promise<{ ok: boolean; result?: unknown; error?: string; stdout: string; stderr: string; contract?: ModuleContract }> {
    // Validation is re-entrant by nature — it is triggered by a write, and a
    // write can come from a script that is itself running in a worker.
    const slot = await this.acquire(request.mode === "load");
    const id = `r${++this.seq}`;
    const deadline = Date.now() + this.deps.limits.runTimeoutMs;

    try {
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (value: Awaited<ReturnType<WorkerPool["execute"]>>): void => {
          if (settled) return;
          settled = true;
          clearTimeout(killer);
          slot.worker.off("message", onMessage);
          slot.worker.off("error", onError);
          slot.worker.off("exit", onExit);
          resolve(value);
        };

        const onMessage = (m: WorkerToHost): void => {
          if (m.type === "need") {
            void this.serve(slot, m);
            return;
          }
          if (m.type === "result" && m.id === id) {
            const r = m as ResultMessage;
            finish({
              ok: r.ok,
              result: r.resultJson === undefined ? undefined : JSON.parse(r.resultJson),
              error: r.error,
              stdout: r.stdout,
              stderr: r.stderr,
              contract: r.contract,
            });
          }
        };

        const onError = (e: Error): void => {
          slot.poisoned = true;
          finish({ ok: false, error: this.describeWorkerFailure(e), stdout: "", stderr: "" });
        };

        // A worker can also go away without an `error` — `close()` terminating
        // it, or the thread exiting on its own. Without this the run's promise
        // settles only when the killer fires, so shutting a host down while a
        // script is running leaves whoever called `runScript` hanging for the
        // remainder of `runTimeoutMs`.
        const onExit = (code: number): void => {
          slot.poisoned = true;
          finish({
            ok: false,
            error: this.closed
              ? "the working environment was closed while this script was running"
              : `script worker exited unexpectedly with code ${code}`,
            stdout: "",
            stderr: "",
          });
        };

        // THE backstop. Everything else about the deadline is advisory; this
        // is the part that cannot be defeated by what the script does.
        const killer = setTimeout(
          () => {
            slot.poisoned = true;
            void slot.worker.terminate();
            finish({
              ok: false,
              error: new EnvLimitError(
                `script exceeded the wall-clock limit: ${this.deps.limits.runTimeoutMs}ms (limits.runTimeoutMs) and was terminated`,
              ).message,
              stdout: "",
              stderr: "",
            });
          },
          this.deps.limits.runTimeoutMs + (this.options.graceMs ?? DEFAULT_GRACE_MS),
        );

        slot.worker.on("message", onMessage);
        slot.worker.once("error", onError);
        slot.worker.once("exit", onExit);
        slot.worker.postMessage({
          type: "run",
          id,
          mode: request.mode,
          path: request.path,
          argsJson: request.args === undefined ? undefined : JSON.stringify(request.args),
          readOnly: request.readOnly,
          overlay: request.overlay ? [...request.overlay.entries()] : undefined,
          deadline,
        } satisfies HostToWorker);
      });
    } finally {
      this.release(slot);
    }
  }

  /**
   * Shut the pool down: refuse new work, let in-flight runs finish within a
   * bounded grace, then terminate whatever is left.
   *
   * The grace is not politeness. A script mid-way through writing its outputs
   * has produced half a file, and when the filesystem is a real host
   * directory rather than memory, that half file outlives the process. Giving
   * the run a moment to reach its own end is the difference between a
   * finished artifact and a torn one.
   *
   * It is bounded because the alternative is worse: `runTimeoutMs` defaults
   * to 30s, and a host that is shutting down cannot wait that long on work
   * whose result nobody will read. Whatever has not finished by then is
   * terminated, and its run resolves with an error saying so rather than
   * hanging.
   */
  async close(options: { graceMs?: number } = {}): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.queue.splice(0)) waiter();

    const grace = options.graceMs ?? this.options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    const deadline = Date.now() + Math.max(0, grace);
    while (this.slots.some((s) => s.busy) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const slots = this.slots;
    this.slots = [];
    await Promise.all(slots.map((s) => s.worker.terminate().catch(() => undefined)));
  }
}
