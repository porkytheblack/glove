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
import { describeShape, type HostToWorker, type NeedMessage, type ResultMessage, type ShapeNode, type WorkerToHost } from "./protocol";

export interface PoolDeps {
  readSource(path: string): Promise<string | null>;
  envModules(readOnly: boolean): Map<string, Record<string, unknown>>;
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
}

const DEFAULT_SIZE = 1;
const DEFAULT_GRACE_MS = 250;

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
    const describe = (readOnly: boolean): Record<string, ShapeNode> => {
      const out: Record<string, ShapeNode> = {};
      for (const [name, ns] of this.deps.envModules(readOnly)) out[name] = describeShape(ns);
      return out;
    };
    this.shapes = { readWrite: describe(false), readOnly: describe(true) };
    return this.shapes;
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
      stdout: true,
      stderr: true,
    });
    worker.unref();

    const slot: Slot = { worker, busy: false, poisoned: false, ready: Promise.resolve() };
    slot.ready = new Promise<void>((resolve, reject) => {
      const onMessage = (m: WorkerToHost): void => {
        if (m.type === "ready") {
          worker.off("message", onMessage);
          this.spawnFailures = 0;
          resolve();
        }
      };
      worker.on("message", onMessage);
      worker.once("error", (e) => reject(e));
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`worker exited with code ${code} before becoming ready`));
      });
    });

    worker.postMessage({ type: "start", limits: this.deps.limits, shapes: this.shapeSet() } satisfies HostToWorker);
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

  private release(slot: Slot): void {
    slot.busy = false;
    if (slot.poisoned) {
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
          finish({ ok: false, error: `script worker failed: ${e.message}`, stdout: "", stderr: "" });
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
   * Shut the pool down.
   *
   * Graceful by intent — in-flight runs are given the remaining grace before
   * their workers are terminated — but unconditional in the end, because a
   * host that is shutting down cannot be held open by a script that will not
   * stop.
   */
  async close(): Promise<void> {
    this.closed = true;
    const slots = this.slots;
    this.slots = [];
    for (const waiter of this.queue.splice(0)) waiter();
    await Promise.all(slots.map((s) => s.worker.terminate().catch(() => undefined)));
  }
}
