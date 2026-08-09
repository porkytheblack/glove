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
import { runContext } from "../core/run-context";
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
   * How long a freshly spawned worker has to signal that it is ready, in ms.
   * Default 10000.
   *
   * There is no scenario where waiting longer is better than being told. A
   * worker that never signals ready holds the slot it was given, and with the
   * default pool size of 1 that means `run_script` waits forever — silently,
   * because write-time validation still works through the overflow path, so
   * the environment looks healthy right up until a run is asked for. Measured
   * causes: a host whose `execArgv` the worker inherits and which blocks on
   * stdin, and thread-creation pressure under many concurrent environments.
   */
  readyTimeoutMs?: number;
  /**
   * Watch a run as it happens: called with batches of console output while
   * the script is still going.
   *
   * Without it a long run is silent between `tool_use` and `tool_result`, and
   * a host cannot tell frame 900 of 1800 from a hang — which is also what it
   * needs in order to offer a meaningful cancel. Scripts already narrate with
   * `console.log`; nothing about the model-facing surface changes.
   *
   * The lines still arrive in full with the result, so this is a tee: a host
   * that ignores it loses nothing. Streaming is only switched on in the
   * worker when a callback is present.
   */
  onProgress?: (event: { runId: string; script: string; stream: "stdout" | "stderr"; text: string }) => void;
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
const DEFAULT_READY_TIMEOUT_MS = 10_000;

/** What a queued run is told when the environment shuts down under it. */
const CLOSED_MESSAGE = "the working environment was closed before this script started";

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

/**
 * A per-run budget, bounded by the environment's ceiling.
 *
 * Clamped rather than refused: a caller asking for more than the environment
 * allows gets the environment's answer, which is the same thing that would
 * have happened without the parameter. Nonsense (zero, negative, NaN) falls
 * back to the ceiling for the same reason — a run with no budget at all is
 * never what anyone meant.
 */
function clampBudget(requested: number | undefined, ceiling: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return ceiling;
  return Math.min(Math.round(requested), ceiling);
}

export interface Slot {
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
  /**
   * Waiters for a worker, in arrival order, each handed a slot directly.
   *
   * Handing the slot over rather than merely waking the waiter is what makes
   * the order mean anything: a `release` that only says "one is free" leaves
   * the freed worker up for grabs, and a caller entering `acquire` in the
   * same turn takes it before the woken waiter runs. Under sustained load
   * that starves whoever has waited longest — the opposite of a queue. `null`
   * means "nothing was handed over, look again".
   */
  private queue: Array<(slot: Slot | null) => void> = [];
  private shapes: { readWrite: Record<string, ShapeNode>; readOnly: Record<string, ShapeNode> } | null = null;
  private spawnFailures = 0;
  private warnedAboutHeap = false;
  private closed = false;
  private seq = 0;
  /**
   * Runs whose result has already been reported as a failure.
   *
   * A terminated worker does not stop the host: a capability call it made is
   * still running here, and `core.write` in particular may be queued behind
   * whatever holds the mutation lock. So "this run is over" has to be a fact
   * the host can consult, not something inferred from the worker being gone.
   * Insertion-ordered and trimmed, because the only thing that matters is the
   * recent past — anything older has long since finished or failed.
   */
  private readonly abandonedRuns = new Set<string>();
  /**
   * Runs in flight, so a capability call can be given its run's abort signal.
   *
   * Keyed by the same id the worker stamps onto every `need`. Entries are
   * removed the moment the run settles — a run that has finished cannot have
   * a call outstanding worth cancelling.
   */
  private readonly liveRuns = new Map<string, { signal?: AbortSignal }>();
  /** The warm in flight, so a second caller joins it instead of over-spawning. */
  private warming: Promise<void> | null = null;

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

  /** Protected so a test can substitute a worker that misbehaves on purpose. */
  protected spawn(): Slot {
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
    // `awaitReady` can abandon this promise on its own deadline, and a
    // rejection nobody is awaiting takes the host process down. Marking it
    // handled here does not stop `await slot.ready` from seeing the failure.
    slot.ready.catch(() => undefined);

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
    for (;;) {
      // Re-checked every pass, not just on entry. `close()` wakes the queued
      // waiters, and a waiter that resumed here used to find free capacity,
      // spawn a worker AFTER close, and run the queued script on a thread
      // nothing would ever terminate — leaking it with its heap until the
      // process exits, and violating the contract that close() means closed.
      if (this.closed) throw new Error(CLOSED_MESSAGE);

      const free = this.slots.find((s) => !s.busy && !s.poisoned);
      if (free) {
        free.busy = true;
        try {
          await this.awaitReady(free);
          return free;
        } catch {
          // Never became usable after all: drop it and look again rather
          // than handing back a slot marked busy forever.
          this.discard(free);
          continue;
        }
      }

      if (overflow || this.slots.filter((s) => !s.poisoned).length < this.size) {
        let slot: Slot | null = null;
        try {
          slot = this.spawn();
          this.slots.push(slot);
          slot.busy = true;
          await this.awaitReady(slot);
          return slot;
        } catch (e) {
          // The slot was counted against capacity from the moment it was
          // pushed. Leaving it there — busy, never ready — permanently
          // shrinks the pool, and at the default size of 1 that means every
          // later run waits forever with nothing to time it out.
          if (slot) this.discard(slot);
          this.spawnFailures += 1;
          if (this.spawnFailures > 5) {
            throw new Error(
              `could not start a script worker after ${this.spawnFailures} attempts: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          await new Promise((r) => setTimeout(r, backoffMs(this.spawnFailures - 1)));
          continue;
        }
      }
      // All busy — wait to be handed one.
      const handed = await new Promise<Slot | null>((resolve) => this.queue.push(resolve));
      if (handed) {
        // Already reserved for us by `release`; nobody could take it in
        // between. It has run before, so `ready` is long since settled.
        try {
          await this.awaitReady(handed);
          return handed;
        } catch {
          this.discard(handed);
        }
      }
    }
  }

  /** Remove a slot from the pool and terminate its thread. */
  private discard(slot: Slot): void {
    this.slots = this.slots.filter((s) => s !== slot);
    slot.poisoned = true;
    void slot.worker.terminate().catch(() => undefined);
  }

  /**
   * Spawn up to `size` workers now, so the first script does not pay for it.
   *
   * A cold pool spawns on first `acquire`, which means the first `run_script`
   * of a session — or the first script the model writes, since write-time
   * validation runs in a worker too — carries ~82 ms of thread start-up that
   * has nothing to do with the work. A host that knows a session is beginning
   * (an environment created per conversation, a desk restored from a snapshot)
   * can pay it during the wait it already has.
   *
   * **Never rejects.** It is called from `createWorkingEnvironment` without an
   * `await`, and a rejected promise nobody is holding takes the process down.
   * A spawn that fails is discarded and the pool is left exactly as it was, to
   * be retried on demand at the first acquire — where the backoff, the attempt
   * counter and the named error already live. Nothing about a failed prewarm
   * is worth failing a create over: the environment is entirely usable, it is
   * just cold.
   */
  async warmup(): Promise<void> {
    if (this.closed) return;
    // A second caller joins the warm already running rather than starting
    // another. `createWorkingEnvironment` fires one off when `prewarm` is set,
    // and a host that then calls `env.warmup()` to wait for it must actually
    // wait — two independent warms would race past `size` and spawn threads
    // the pool immediately discards as surplus.
    if (this.warming) return this.warming;
    const warm = this.warmInner().finally(() => {
      this.warming = null;
    });
    this.warming = warm;
    return warm;
  }

  private async warmInner(): Promise<void> {
    while (!this.closed && this.slots.filter((s) => !s.poisoned).length < this.size) {
      let slot: Slot | null = null;
      try {
        slot = this.spawn();
        this.slots.push(slot);
        await this.awaitReady(slot);
        // `close()` can land while a worker is starting. It took its copy of
        // `slots` before this one was pushed, so nothing else will ever
        // terminate it — the exact leak `acquire` re-checks `closed` for.
        if (this.closed) this.discard(slot);
      } catch {
        if (slot) this.discard(slot);
        return;
      }
    }
  }

  /**
   * Wait for a worker to signal ready, bounded.
   *
   * Unbounded, this is the quietest way the environment fails: the slot stays
   * busy, `run_script` never returns, and no deadline fires because the
   * deadline killer is only armed after acquire succeeds. Everything else
   * keeps working — write-time validation takes the overflow path — so the
   * environment looks healthy while runs pile up against nothing.
   */
  private async awaitReady(slot: Slot): Promise<void> {
    const ms = Math.max(1, this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        slot.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `a script worker did not become ready within ${ms}ms (execution.readyTimeoutMs). ` +
                    `Something is blocking the thread before it can run anything — most often a host --exec-argv ` +
                    `the worker inherits (an inspector or a flag that reads stdin), or thread-creation pressure ` +
                    `from too many environments at once.`,
                ),
              ),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
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
    const reusable = !slot.poisoned && !surplus;
    if (!reusable) {
      this.slots = this.slots.filter((s) => s !== slot);
      void slot.worker.terminate();
    }

    const next = this.queue.shift();
    if (!next) return;
    if (!reusable || this.closed) {
      next(null); // nothing to give; let the waiter re-enter the loop
      return;
    }
    slot.busy = true; // reserved for this waiter before anyone else can look
    next(slot);
  }

  /** Mark a run dead so no further host work is done on its behalf. */
  private abandon(id: string): void {
    this.abandonedRuns.add(id);
    while (this.abandonedRuns.size > 256) {
      const oldest = this.abandonedRuns.values().next().value;
      if (oldest === undefined) break;
      this.abandonedRuns.delete(oldest);
    }
  }

  /** Why a call on behalf of `run` must be refused, or null while it is live. */
  private refusalFor(run: string | undefined): string | null {
    if (run === undefined || !this.abandonedRuns.has(run)) return null;
    return (
      `this script's run has already ended (it was terminated or the environment was closed), ` +
      `so the environment refused to apply its remaining changes`
    );
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

    // Checked before anything is invoked, not only before replying. A run
    // reported dead must stop having effects, and by the time the reply is
    // written the mutation has already happened.
    const refusal = slot.poisoned ? "the script worker was terminated" : this.refusalFor(message.run);
    if (refusal) {
      respond(false, undefined, new Error(refusal));
      return;
    }
    const guard = {
      abandoned: (): string | null => this.refusalFor(message.run),
      signal: message.run === undefined ? undefined : this.liveRuns.get(message.run)?.signal,
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
        respond(true, await runContext.run(guard, () => spec.replay(message.ops ?? [])));
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
        // Inside the run context, so a mutation that queues behind the
        // lock is refused if this run dies while it waits — the window the
        // entry check above cannot cover.
        const result = await runContext.run(guard, () => (target as (...a: unknown[]) => unknown).apply(owner, message.args ?? []));
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
    /** Host-facing id for progress events, so they line up with run history. */
    runId?: string;
    /**
     * Cancel this run without touching the rest of the environment.
     *
     * The only ways a run could end early were the global deadline and
     * `close()`, which shuts the whole pool — so a host with a Stop button, or
     * an SSE client that hung up, had to rebuild the environment from a
     * snapshot and lose the warm worker to stop one script.
     */
    signal?: AbortSignal;
    /**
     * Budget for this run alone, clamped to `limits.runTimeoutMs`.
     *
     * The ceiling is the environment's; this only ever asks for less. Raising
     * the environment-wide limit to accommodate one slow adapter is what the
     * absence of this forced, and it hands the same four minutes to an
     * accidental `for(;;)`.
     */
    timeoutMs?: number;
  }): Promise<{ ok: boolean; result?: unknown; error?: string; stdout: string; stderr: string; contract?: ModuleContract }> {
    // Validation is re-entrant by nature — it is triggered by a write, and a
    // write can come from a script that is itself running in a worker.
    let slot: Slot;
    try {
      slot = await this.acquire(request.mode === "load");
    } catch (e) {
      // A pool that cannot hand out a worker — closed, or out of spawn
      // attempts — is a failed run, not a thrown host error. `runScript`
      // promises to resolve with a reason rather than leave a caller hanging.
      return { ok: false, error: e instanceof Error ? e.message : String(e), stdout: "", stderr: "" };
    }
    const id = `r${++this.seq}`;
    const budgetMs = clampBudget(request.timeoutMs, this.deps.limits.runTimeoutMs);
    const deadline = Date.now() + budgetMs;
    this.liveRuns.set(id, { signal: request.signal });

    try {
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (value: Awaited<ReturnType<WorkerPool["execute"]>>): void => {
          if (settled) return;
          settled = true;
          // The moment a failure is reported is the moment the run's remaining
          // host work becomes illegitimate — the caller has been told the run
          // died, and anything that lands afterwards diverges the tree from
          // what the model believes. Terminating the worker does not stop
          // work already in flight over here.
          if (!value.ok) this.abandon(id);
          this.liveRuns.delete(id);
          clearTimeout(killer);
          request.signal?.removeEventListener("abort", cancel);
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
          if (m.type === "progress") {
            if (m.id !== id) return; // a batch from a previous run on this worker
            for (const line of m.lines) {
              // A host callback must not be able to fail the run it is
              // watching — it is an observer, not a participant.
              try {
                this.options.onProgress?.({
                  runId: request.runId ?? id,
                  script: request.path,
                  stream: line.stream,
                  text: line.text,
                });
              } catch {
                // ignored on purpose
              }
            }
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

        // Cancellation reuses the killer's path exactly — poison, terminate,
        // resolve with a name — because that path is already the only thing
        // that reliably stops a thread whatever it is doing. `finish` marks
        // the run abandoned, so a write it had already handed to the host is
        // refused rather than landing after the caller was told it stopped.
        const cancel = (): void => {
          slot.poisoned = true;
          void slot.worker.terminate();
          finish({
            ok: false,
            error: "the script was cancelled by the host before it finished",
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
                budgetMs >= this.deps.limits.runTimeoutMs
                  ? `script exceeded the wall-clock limit: ${budgetMs}ms (limits.runTimeoutMs) and was terminated`
                  : `script exceeded the wall-clock limit for this run: ${budgetMs}ms (run_script timeout_ms) and was terminated; ` +
                    `this environment allows up to ${this.deps.limits.runTimeoutMs}ms`,
              ).message,
              stdout: "",
              stderr: "",
            });
          },
          budgetMs + (this.options.graceMs ?? DEFAULT_GRACE_MS),
        );

        // Registered after the killer exists: `finish` clears it, and an
        // already-aborted signal firing before that `const` is initialised
        // reaches it in its temporal dead zone.
        if (request.signal?.aborted) {
          cancel();
          return;
        }
        request.signal?.addEventListener("abort", cancel, { once: true });

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
          budgetMs,
          progress: this.options.onProgress !== undefined,
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
    for (const waiter of this.queue.splice(0)) waiter(null);

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
