/**
 * The worker side of script execution.
 *
 * This is deliberately thin. The `ScriptExecutor` that runs here is the same
 * class the host used to run in-process — the vm context, the realm bridge,
 * the module transform, the deadline guards, all unchanged. What changes is
 * only where its four dependencies come from: `readSource`,
 * `isEnforcedScript` and the `env:*` namespaces now travel over
 * `postMessage` instead of being called directly.
 *
 * The realm story is unchanged and, if anything, stronger. Inside this thread
 * the bridge still separates the vm context from the worker's own realm, so
 * `tests/sandbox.test.ts` holds exactly as before. And the real host — the
 * VFS, the adapters, the process the operator cares about — is now in a
 * different thread that a runaway script cannot reach or stall.
 */
import { parentPort } from "node:worker_threads";
import { getHeapStatistics } from "node:v8";
import { ScriptExecutor, newCapture, type ConsoleCapture } from "./executor";
import { ScriptContractError, contractOf } from "../pipeline/contract";
import { createStdBindings } from "../builtins/std";
import { createAssertBindings } from "../builtins/assert";
import { tagBindings } from "../adapters/tag";
import { pickFrom } from "../adapters/pure";
import { makeBuilder } from "./recorder";
import type { BuilderOp, HostToWorker, NeedMessage, ProgressMessage, ResultMessage, RunMessage, ShapeNode, StartMessage } from "./protocol";
import type { EnvLimits } from "../types";

if (!parentPort) throw new Error("glove worker entry loaded outside a worker thread");
const port = parentPort;

let seq = 0;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
/**
 * The run currently executing, stamped onto every host call it makes.
 *
 * A worker serves one run at a time, so a single variable is the whole
 * bookkeeping. The host needs it because a slot is not a run: a terminated
 * run's last call can still be in flight on the host when the pool has
 * already replaced the worker.
 */
let currentRun: string | undefined;

/** Ask the host something and await its reply. */
function need(message: Omit<NeedMessage, "type" | "id">): Promise<unknown> {
  const id = `n${++seq}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    port.postMessage({ type: "need", id, run: currentRun, ...message } satisfies NeedMessage);
  });
}

/**
 * Rebuild a namespace from its shape, with every function an RPC stub.
 *
 * The stubs are ordinary async functions in the worker's realm; the bridge
 * wraps them into the vm context exactly as it wrapped the host's originals,
 * so nothing downstream can tell the difference.
 */
function buildNamespace(module: string, node: ShapeNode, readOnly: boolean, route: string[] = []): unknown {
  if (node.kind === "value") return node.value;
  if (node.kind === "builder") {
    // The recording crosses as data on the terminal call, like any other
    // capability argument — the proxy itself never leaves the worker.
    return makeBuilder(node, {
      flush: (name, ops: BuilderOp[]) =>
        need({ what: "builder", module, builder: name, ops, readOnly }) as Promise<unknown>,
    });
  }
  if (node.kind === "fn") {
    const here = [...route];
    const stub = async (...args: unknown[]): Promise<unknown> =>
      need({ what: "capability", module, route: here, args, readOnly });
    // The bridge copies these onto the context-realm wrapper. Without them a
    // capability reaches the script anonymous and zero-arity, which is wrong
    // in a stack trace and wrong for anything reflecting on it.
    Object.defineProperty(stub, "name", { value: node.name, configurable: true });
    Object.defineProperty(stub, "length", { value: node.arity, configurable: true });
    return stub;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node.entries)) {
    out[key] = buildNamespace(module, child, readOnly, [...route, key]);
  }
  return out;
}

/**
 * Builtins that are pure computation, constructed here rather than called
 * across the thread.
 *
 * This is not an optimisation, it is a correctness requirement. `env:std` and
 * `env:assert` are SYNCHRONOUS APIs — `json.parse(text)` returns the value,
 * not a promise for it — and a synchronous call cannot be answered over
 * `postMessage`. An RPC stub would hand the script a Promise, so
 * `Object.keys(json.parse(s))` would quietly evaluate to `[]`.
 *
 * They are also the right things to run here on the merits: no host state, no
 * VFS, no adapter libraries, and they are the hottest functions a script
 * calls. Only capabilities that genuinely touch host state — `env:fs` and the
 * stdlib adapters, all of which are async — need the round trip.
 */
const LOCAL_BUILTINS: Record<string, () => Record<string, unknown>> = {
  std: createStdBindings,
  assert: createAssertBindings,
};

function buildModules(
  shapes: Record<string, ShapeNode>,
  readOnly: boolean,
  pure: Map<string, Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const modules = new Map<string, Record<string, unknown>>();
  for (const [name, shape] of Object.entries(shapes)) {
    const local = LOCAL_BUILTINS[name];
    // Tagged the same way the host seals them, so a failure inside one still
    // reads `env:std.csv.parse: …` rather than a bare message.
    const ns = (local ? tagBindings(name, local()) : buildNamespace(name, shape, readOnly)) as Record<string, unknown>;
    // `import fs from 'env:fs'` yields the whole module, as the host's seal()
    // arranges. Rebuilt here rather than sent, since it is a cycle.
    ns.default = ns;
    modules.set(name, ns);
  }
  // Pure modules take the LOCAL_BUILTINS path, not the shape path: their
  // bindings live in this thread, and going through tagBindings means a
  // failure inside one still names the capability.
  for (const [name, bindings] of pure) {
    const ns = tagBindings(name, bindings) as Record<string, unknown>;
    ns.default = ns;
    modules.set(name, ns);
  }
  return modules;
}

let executor: ScriptExecutor | null = null;
let limits: EnvLimits;
let readWrite: Map<string, Record<string, unknown>>;
let readOnlySet: Map<string, Record<string, unknown>>;

async function start(message: StartMessage): Promise<void> {
  limits = message.limits;

  // Pure modules are imported HERE, in the worker's own realm, which is what
  // makes them synchronous for scripts — a call never leaves the thread. The
  // host already imported the same URLs and verified every pick, so this is
  // a replay of a known-good import, not a first attempt.
  const pure = new Map<string, Record<string, unknown>>();
  for (const p of message.pure ?? []) {
    const ns = (await import(p.url)) as Record<string, unknown>;
    const bindings: Record<string, unknown> = {};
    for (const name of p.pick) bindings[name] = pickFrom(ns, name);
    pure.set(p.name, bindings);
  }

  readWrite = buildModules(message.shapes.readWrite, false, pure);
  readOnlySet = buildModules(message.shapes.readOnly, true, pure);
  executor = new ScriptExecutor({
    readSource: async (path) => (await need({ what: "readSource", path })) as string | null,
    envModules: (ro) => (ro ? readOnlySet : readWrite),
    // Synchronous in the executor's contract, so it is resolved from the set
    // the host already sent rather than asked for per call.
    isEnforcedScript: (path) => enforced(path),
    limits,
  });
  port.postMessage({ type: "ready", heapLimitMb: getHeapStatistics().heap_size_limit / (1024 * 1024) });
}

/**
 * Mirror of the host's rule. Kept here rather than made an RPC because the
 * executor calls it synchronously, and because it is a pure predicate over
 * the path — there is nothing host-specific to ask about.
 */
function enforced(path: string): boolean {
  if (!path.startsWith("/scripts/")) return false;
  if (path.endsWith(".test.js")) return true;
  return path.endsWith(".js") && !path.startsWith("/scripts/lib/");
}

/** Batching window for progress lines. See {@link streamProgress}. */
const PROGRESS_FLUSH_MS = 120;
const PROGRESS_MAX_BATCH = 50;

/**
 * Tee this run's console output to the host as it is written, in batches.
 *
 * Batched rather than per-line because a script logging inside a loop would
 * otherwise post a message per iteration, and `postMessage` structured-clones
 * and wakes the host each time — turning narration into the slowest thing the
 * script does. The transcript still crosses in full with the result; this is
 * only about *when* the host can see it.
 *
 * ## Why the window is checked at write time and not on a timer
 *
 * A timer here does not fire. Scripts have no `setTimeout` of their own, so
 * the way a model writes "wait" is `while (Date.now() < until) await null` —
 * which keeps the microtask queue permanently non-empty and starves the
 * macrotask queue the timer lives on. Measured: a 10-step script logging each
 * step delivered every line at the end, i.e. exactly the silence this exists
 * to remove.
 *
 * So the elapsed check happens where lines actually arrive. The timer stays
 * as a backstop for the other shape — a few lines, then a long wait on a real
 * capability call, which does yield to macrotasks.
 */
function streamProgress(capture: ConsoleCapture, runId: string): () => void {
  let pending: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastFlush = Date.now();

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    lastFlush = Date.now();
    if (pending.length === 0) return;
    const lines = pending;
    pending = [];
    port.postMessage({ type: "progress", id: runId, lines } satisfies ProgressMessage);
  };

  capture.onLine = (stream, text) => {
    pending.push({ stream, text });
    if (pending.length >= PROGRESS_MAX_BATCH || Date.now() - lastFlush >= PROGRESS_FLUSH_MS) return flush();
    if (timer === undefined) {
      timer = setTimeout(flush, PROGRESS_FLUSH_MS);
      // Never hold the thread open for a batch nobody is waiting on.
      timer.unref?.();
    }
  };
  return flush;
}

async function handleRun(message: RunMessage): Promise<void> {
  currentRun = message.id;
  const capture = newCapture();
  // Only real runs stream. A `load` is write-time validation: its console
  // output is a side effect of evaluating a module the model is saving, not
  // progress on anything the host asked for.
  const flushProgress = message.mode === "run" && message.progress ? streamProgress(capture, message.id) : null;
  const reply = (partial: Omit<ResultMessage, "type" | "id" | "stdout" | "stderr">): void => {
    capture.onLine = undefined;
    flushProgress?.();
    port.postMessage({
      type: "result",
      id: message.id,
      stdout: capture.out.join("\n"),
      stderr: capture.err.join("\n"),
      ...partial,
    } satisfies ResultMessage);
  };

  if (!executor) return reply({ ok: false, error: "worker was not started" });
  const overlay = message.overlay ? new Map(message.overlay) : undefined;

  try {
    if (message.mode === "load") {
      const ns = await executor.loadModule(message.path, {
        overlay,
        capture,
        readOnly: message.readOnly,
        deadline: message.deadline,
        budgetMs: message.budgetMs,
      });
      reply({ ok: true, contract: contractOf(ns) });
      return;
    }
    const args = message.argsJson === undefined ? undefined : JSON.parse(message.argsJson);
    // The host's deadline, not a fresh one. Recomputing `now + runTimeoutMs`
    // here gave the worker a later deadline than the killer already counting
    // down, and made a per-run budget invisible to everything inside the vm.
    const run = await executor.run(message.path, args, {
      overlay,
      capture,
      readOnly: message.readOnly,
      deadline: message.deadline,
      budgetMs: message.budgetMs,
    });
    // JSON rather than structured clone: the host must receive plain data,
    // and a value that will not serialize is a script bug worth reporting
    // rather than a clone error from the thread boundary.
    let resultJson: string | undefined;
    if (run.ok) {
      try {
        resultJson = JSON.stringify(run.result ?? null);
      } catch {
        resultJson = JSON.stringify(null);
      }
    }
    reply({ ok: run.ok, resultJson, error: run.error });
  } catch (e) {
    // A contract failure on the module actually being written is reported
    // bare: the caller already knows the path, and prefixing it turns a
    // guardrail message into "path: path: …" by the time the verb renders it.
    if (e instanceof ScriptContractError && e.path === message.path) {
      reply({ ok: false, error: e.contractMessage });
      return;
    }
    reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

port.on("message", (message: HostToWorker) => {
  // start() is async only for pure-module imports. A rejection here is a
  // broken environment (the host already imported the same URLs), and letting
  // it become an unhandled rejection kills this worker — which is the right
  // outcome, and the pool's failure translation names it.
  if (message.type === "start") return void start(message);
  if (message.type === "run") {
    void handleRun(message);
    return;
  }
  if (message.type === "reply") {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.value);
    else {
      const err = new Error(message.error?.message ?? "host call failed");
      err.name = message.error?.name ?? "Error";
      waiter.reject(err);
    }
  }
});
