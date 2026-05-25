import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnyAgent } from "./agent.js";
import type { ContinuumAdapter } from "./adapters/index.js";
import { MemoryAdapter } from "./adapters/memory.js";
import { configure } from "./config.js";
import { parseInterval } from "./interval.js";
import type { ChildToParentMessage, IPCMessage } from "./ipc.js";
import type {
  AgentEventEnvelope,
  ContinuumSubscriber,
} from "./subscribers/index.js";
import { ConsoleSubscriber } from "./subscribers/console.js";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WARM_RESTART_BACKOFF_MS,
  DEFAULT_WARM_RESTART_MAX,
  type AgentMode,
  type Run,
} from "./types.js";
import { isAgent } from "./util.js";

function resolveBootstrap(): string {
  // Prefer the built JS bootstrap (dist/bootstrap.js); fall back to the TS
  // source under tsx for dev/test setups where `dist/` doesn't exist.
  const jsPath = fileURLToPath(new URL("./bootstrap.js", import.meta.url));
  if (existsSync(jsPath)) return jsPath;
  const tsPath = fileURLToPath(new URL("./bootstrap.ts", import.meta.url));
  if (existsSync(tsPath)) return tsPath;
  return jsPath; // will surface as a spawn error
}
const BOOTSTRAP = resolveBootstrap();

let _tsxImport: string | undefined;
function getTsxImport(): string | undefined {
  if (_tsxImport !== undefined) return _tsxImport || undefined;
  if (process.env.__CONTINUUM_TSX) {
    _tsxImport = process.env.__CONTINUUM_TSX;
    return _tsxImport;
  }
  try {
    _tsxImport = import.meta.resolve("tsx");
    return _tsxImport;
  } catch {
    _tsxImport = "";
    return undefined;
  }
}

interface RegisteredAgent {
  name: string;
  mode: AgentMode;
  filePath: string;
  agent: AnyAgent;
}

interface RecurringSchedule {
  agentName: string;
  interval: string;
  nextRunAt: Date;
  timeout: number;
  maxAttempts: number;
  input?: string;
}

interface WarmAgentHandle {
  agentName: string;
  child: ChildProcess;
  ready: boolean;
  pendingNotifies: Map<string, Run>;
  outboxQueue: Array<{ runId: string; input: unknown }>;
  restarts: number;
  startedAt: Date;
}

export interface ContinuumRunnerOptions {
  agentsDir?: string;
  adapter?: ContinuumAdapter;
  pollIntervalMs?: number;
  /** Default maxAttempts for agents that don't specify their own. */
  maxAttempts?: number;
  subscribers?: ContinuumSubscriber[];
  /** Maximum number of in-flight triggered runs. Default 5. */
  maxConcurrent?: number;
  /** Base ms for exponential retry backoff. Default 1000. */
  retryBackoffMs?: number;
  /** Restart policy for warm subprocesses that exit unexpectedly. */
  warmRestartPolicy?: { maxRestarts: number; backoffMs: number };
}

export class ContinuumRunner {
  private adapter: ContinuumAdapter;
  private pollIntervalMs: number;
  private agentsDir?: string;
  private defaultMaxAttempts: number;
  private retryBackoffMs: number;
  private maxConcurrent: number;
  private warmRestartPolicy: { maxRestarts: number; backoffMs: number };

  private registry = new Map<string, RegisteredAgent>();
  private recurringSchedules = new Map<string, RecurringSchedule>();
  private subscribers: ContinuumSubscriber[];

  private activeCount = 0;
  private activePerAgent = new Map<string, number>();

  /** Per-triggered-run kill targets (cancel / timeout). */
  private childByRunId = new Map<string, ChildProcess>();
  /** Per-concurrent-agent long-lived subprocesses. */
  private warmAgents = new Map<string, WarmAgentHandle>();
  /** Names of concurrent agents currently being restarted (debounce). */
  private restartingWarmAgents = new Set<string>();

  private running = false;
  private stopping = false;
  private ticking = false;

  constructor(options: ContinuumRunnerOptions = {}) {
    const adapter = options.adapter ?? new MemoryAdapter();
    configure({ adapter });
    this.adapter = adapter;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.agentsDir = options.agentsDir;
    this.defaultMaxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.subscribers = options.subscribers ? [...options.subscribers] : [];
    this.warmRestartPolicy = options.warmRestartPolicy ?? {
      maxRestarts: DEFAULT_WARM_RESTART_MAX,
      backoffMs: DEFAULT_WARM_RESTART_BACKOFF_MS,
    };
  }

  static create(
    agentsDir: string,
    options: Omit<ContinuumRunnerOptions, "agentsDir"> = {},
  ): ContinuumRunner {
    const subscribers = options.subscribers ?? [new ConsoleSubscriber()];
    return new ContinuumRunner({ ...options, agentsDir, subscribers });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getAdapter(): ContinuumAdapter {
    return this.adapter;
  }

  subscribe(s: ContinuumSubscriber): this {
    this.subscribers.push(s);
    return this;
  }

  registerAgent(a: AnyAgent, filePath: string): this {
    const resolved = resolve(filePath);
    if (this.registry.has(a.name)) {
      console.warn(
        `[glove-continuum-signal] Duplicate agent name "${a.name}" — overwriting with ${resolved}`,
      );
    }
    this.registry.set(a.name, {
      name: a.name,
      mode: a.mode,
      filePath: resolved,
      agent: a,
    });
    this.emit("onAgentDiscovered", {
      agentName: a.name,
      mode: a.mode,
      filePath: resolved,
    });
    if (a.mode === "triggered" && a.interval) {
      this.scheduleRecurring(a);
    }
    if (
      a.mode === "triggered" &&
      !a.storeFactory &&
      a.name !== "__test_no_warn__"
    ) {
      console.warn(
        `[glove-continuum-signal] Triggered agent "${a.name}" has no .store(…) — it will lose context across wakeups.`,
      );
    }
    return this;
  }

  listAgents(): Array<{ name: string; mode: AgentMode; filePath: string }> {
    return Array.from(this.registry.values()).map(
      ({ name, mode, filePath }) => ({ name, mode, filePath }),
    );
  }

  hasAgent(name: string): boolean {
    return this.registry.has(name);
  }

  async getRun(id: string): Promise<Run | null> {
    return this.adapter.getRun(id);
  }

  async listRuns(agentName: string): Promise<Run[]> {
    return this.adapter.listRuns(agentName);
  }

  async waitForRun(
    runId: string,
    opts?: {
      pollMs?: number;
      timeoutMs?: number;
      waitForExistence?: boolean;
    },
  ): Promise<Run | null> {
    const pollMs = opts?.pollMs ?? 100;
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const waitForExistence = opts?.waitForExistence ?? false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.adapter.getRun(runId);
      if (!run) {
        if (!waitForExistence) return null;
        await this.sleep(pollMs);
        continue;
      }
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled"
      ) {
        return run;
      }
      await this.sleep(pollMs);
    }
    return this.adapter.getRun(runId);
  }

  /**
   * Push input to a concurrent agent. Writes a `kind: "notify"` Run and lets
   * the tick loop route it to the warm subprocess. Returns the run id.
   * Throws if the named agent isn't registered or isn't concurrent.
   */
  async notify(name: string, input: unknown): Promise<string> {
    const entry = this.registry.get(name);
    if (!entry) {
      throw new Error(`Agent "${name}" is not registered with this runner.`);
    }
    if (entry.mode !== "concurrent") {
      throw new Error(
        `Agent "${name}" is registered as "${entry.mode}". Use .trigger() for triggered agents; .notify() is concurrent-only.`,
      );
    }
    const result = entry.agent.inputSchema.safeParse(input);
    if (!result.success) {
      throw new Error(
        `Invalid input for agent "${name}": ${result.error.message}`,
      );
    }
    const id = this.adapter.generateId();
    const run: Run = {
      id,
      agentName: name,
      kind: "notify",
      input: JSON.stringify(result.data),
      status: "pending",
      attempts: 0,
      maxAttempts: entry.agent.maxAttempts,
      timeout: entry.agent.timeout,
      createdAt: new Date(),
    };
    await this.adapter.addRun(run);
    return id;
  }

  async cancel(runId: string): Promise<boolean> {
    const run = await this.adapter.getRun(runId);
    if (!run) return false;
    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled"
    ) {
      return false;
    }
    await this.adapter.updateRun(runId, {
      status: "cancelled",
      completedAt: new Date(),
    });
    const child = this.childByRunId.get(runId);
    if (child) {
      child.kill("SIGTERM");
    }
    // Warm-agent notifies can't be individually killed without tearing the
    // warm subprocess down; for v1 the cancel is best-effort (status flips,
    // the in-flight notify completes and its result is discarded by the
    // post-completion status check).
    this.emit("onRunCancelled", { run });
    return true;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("[glove-continuum-signal] Runner is already started");
    }
    if (this.agentsDir) {
      await this.discover(resolve(this.agentsDir));
    }

    // Pre-warm concurrent agents.
    for (const entry of this.registry.values()) {
      if (entry.mode === "concurrent") {
        this.spawnWarmAgent(entry);
      }
    }

    const shutdown = (): void => {
      console.log(
        "[glove-continuum-signal] Received shutdown signal, stopping…",
      );
      this.stop({ graceful: true, timeoutMs: 10_000 }).catch((err) => {
        console.error(
          "[glove-continuum-signal] Error during shutdown:",
          err,
        );
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    this.running = true;
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        console.error("[glove-continuum-signal] tick() failed:", err);
      }
      await this.sleep(this.pollIntervalMs);
    }
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }

  async stop(options?: {
    graceful?: boolean;
    timeoutMs?: number;
  }): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.running = false;
    // Don't cancel in-flight sleeps — let them resolve naturally so the
    // start() loop can observe `this.running === false` and exit. The cost
    // is up to one pollIntervalMs of latency on shutdown.

    // Stop warm agents first so they get a chance to finish in-flight work.
    for (const handle of this.warmAgents.values()) {
      try {
        handle.child.send({ type: "stop" });
      } catch {
        /* socket closed */
      }
    }

    if (
      options?.graceful &&
      (this.childByRunId.size > 0 || this.warmAgents.size > 0)
    ) {
      const timeout = options.timeoutMs ?? 10_000;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      await this.waitForAllChildren(ac.signal);
      clearTimeout(timer);
      for (const child of this.childByRunId.values()) {
        child.kill("SIGTERM");
      }
      for (const handle of this.warmAgents.values()) {
        if (!handle.child.killed) handle.child.kill("SIGTERM");
      }
    } else {
      for (const child of this.childByRunId.values()) {
        child.kill("SIGTERM");
      }
      for (const handle of this.warmAgents.values()) {
        if (!handle.child.killed) handle.child.kill("SIGTERM");
      }
    }

    this.warmAgents.clear();

    try {
      await this.adapter.close?.();
    } catch (err) {
      console.error(
        "[glove-continuum-signal] Error closing adapter:",
        err,
      );
    }
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  private async discover(dir: string): Promise<void> {
    let files: string[];
    try {
      const entries = await readdir(dir, { recursive: true });
      files = entries
        .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
        .map((f) => join(dir, f));
    } catch {
      console.error(
        `[glove-continuum-signal] Cannot read agentsDir: ${dir}`,
      );
      return;
    }

    for (const filePath of files) {
      try {
        const mod = (await import(filePath)) as Record<string, unknown>;
        for (const value of Object.values(mod)) {
          if (isAgent(value)) {
            this.registerAgent(value, filePath);
          }
        }
      } catch (err) {
        console.warn(
          `[glove-continuum-signal] Skipping ${filePath} — failed to import:`,
          err,
        );
      }
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.checkTimeouts();
      await this.tickRecurring();
      this.tickWarmAgents();
      await this.dispatchDue();
    } finally {
      this.ticking = false;
    }
  }

  private async dispatchDue(): Promise<void> {
    const due = await this.adapter.getRunsDue();
    for (const run of due) {
      const entry = this.registry.get(run.agentName);
      if (!entry) {
        const error = `No agent registered for "${run.agentName}"`;
        await this.adapter.updateRun(run.id, {
          status: "failed",
          completedAt: new Date(),
          error,
        });
        this.emit("onRunFailed", { run, error });
        continue;
      }

      // Notify runs route to the warm subprocess; no per-run subprocess.
      if (run.kind === "notify") {
        if (entry.mode !== "concurrent") {
          const error = `Notify run for non-concurrent agent "${run.agentName}"`;
          await this.adapter.updateRun(run.id, {
            status: "failed",
            completedAt: new Date(),
            error,
          });
          this.emit("onRunFailed", { run, error });
          continue;
        }
        await this.routeNotify(entry, run);
        continue;
      }

      // Triggered + recurring share the dispatch path.
      if (entry.mode !== "triggered") {
        const error = `${run.kind} run for non-triggered agent "${run.agentName}"`;
        await this.adapter.updateRun(run.id, {
          status: "failed",
          completedAt: new Date(),
          error,
        });
        this.emit("onRunFailed", { run, error });
        continue;
      }

      if (this.activeCount >= this.maxConcurrent) break;

      if (entry.agent.maxConcurrency !== undefined) {
        const active = this.activePerAgent.get(run.agentName) ?? 0;
        if (active >= entry.agent.maxConcurrency) {
          this.emit("onRunSkipped", {
            run,
            reason: `Concurrency limit (${entry.agent.maxConcurrency}) reached for "${run.agentName}"`,
          });
          continue;
        }
      }

      if (run.attempts > 0 && run.lastRunAt) {
        const backoffMs =
          this.retryBackoffMs * Math.pow(2, run.attempts - 1);
        const elapsed = Date.now() - run.lastRunAt.getTime();
        if (elapsed < backoffMs) continue;
      }

      await this.adapter.updateRun(run.id, {
        status: "running",
        startedAt: new Date(),
        lastRunAt: new Date(),
        attempts: run.attempts + 1,
      });
      const fresh = await this.adapter.getRun(run.id);
      this.activeCount++;
      this.incrementPerAgent(run.agentName);
      const dispatchRun = fresh ?? run;
      this.emit("onRunDispatched", { run: dispatchRun });
      this.dispatchTriggered(entry, dispatchRun);
    }
  }

  private async tickRecurring(): Promise<void> {
    const now = new Date();
    for (const [name, schedule] of this.recurringSchedules) {
      if (schedule.nextRunAt > now) continue;
      const hasPending = await this.adapter.hasRunWithStatus(name, [
        "pending",
        "running",
      ]);
      if (hasPending) {
        const ms = parseInterval(schedule.interval);
        schedule.nextRunAt = new Date(Date.now() + ms);
        continue;
      }
      const id = this.adapter.generateId();
      const run: Run = {
        id,
        agentName: name,
        kind: "recurring",
        input: schedule.input ?? JSON.stringify({}),
        status: "pending",
        attempts: 0,
        maxAttempts: schedule.maxAttempts,
        timeout: schedule.timeout,
        interval: schedule.interval,
        createdAt: new Date(),
      };
      await this.adapter.addRun(run);
      const ms = parseInterval(schedule.interval);
      schedule.nextRunAt = new Date(Date.now() + ms);
      this.emit("onRunRescheduled", { run, nextRunAt: schedule.nextRunAt });
    }
  }

  private async checkTimeouts(): Promise<void> {
    const running = await this.adapter.getRunsRunning();
    for (const run of running) {
      if (!run.startedAt) continue;
      const elapsed = Date.now() - run.startedAt.getTime();
      if (elapsed < run.timeout) continue;

      // Triggered runs have a per-run child to kill. Notify runs share a
      // warm subprocess — we don't kill it; we just fail the notify and let
      // the warm agent continue serving other notifies.
      if (run.kind !== "notify") {
        const child = this.childByRunId.get(run.id);
        if (child) child.kill("SIGTERM");
      } else {
        // For notify runs, clear the pending entry so the eventual
        // completion envelope is treated as orphaned.
        const warm = this.warmAgents.get(run.agentName);
        warm?.pendingNotifies.delete(run.id);
      }

      const current = await this.adapter.getRun(run.id);
      if (!current || current.status !== "running") continue;
      const maxAttempts = current.maxAttempts ?? this.defaultMaxAttempts;
      this.emit("onRunTimeout", { run: current });

      const error = `Timed out after ${current.timeout}ms`;
      if (run.kind !== "notify" && current.attempts < maxAttempts) {
        await this.adapter.updateRun(run.id, {
          status: "pending",
          startedAt: undefined,
          lastRunAt: new Date(),
          error,
        });
        this.emit("onRunRetry", {
          run: current,
          attempt: current.attempts,
          maxAttempts,
        });
      } else {
        await this.adapter.updateRun(run.id, {
          status: "failed",
          completedAt: new Date(),
          error: `${error} (${maxAttempts} attempts exhausted)`,
        });
        this.emit("onRunFailed", { run: current, error });
      }
    }
  }

  private tickWarmAgents(): void {
    if (this.stopping) return;
    for (const entry of this.registry.values()) {
      if (entry.mode !== "concurrent") continue;
      if (this.warmAgents.has(entry.name)) continue;
      if (this.restartingWarmAgents.has(entry.name)) continue;
      // The handle was removed (on death) but the agent should be warm —
      // re-spawn via the restart path (which honours the backoff).
      this.scheduleWarmRestart(entry);
    }
  }

  // ── Concurrent warm subprocess lifecycle ────────────────────────────────

  private spawnWarmAgent(entry: RegisteredAgent): void {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(entry.agent.env ?? {}),
      CONTINUUM_AGENT_FILE: entry.filePath,
      CONTINUUM_AGENT_NAME: entry.name,
      CONTINUUM_MODE: "concurrent",
      CONTINUUM_TIMEOUT: String(entry.agent.timeout ?? DEFAULT_TIMEOUT_MS),
    };
    const tsxImport = getTsxImport();
    const nodeArgs = tsxImport
      ? ["--import", tsxImport, BOOTSTRAP]
      : [BOOTSTRAP];
    const child = spawn("node", nodeArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    const handle: WarmAgentHandle = {
      agentName: entry.name,
      child,
      ready: false,
      pendingNotifies: new Map(),
      outboxQueue: [],
      restarts: 0,
      startedAt: new Date(),
    };
    this.warmAgents.set(entry.name, handle);

    this.emit("onAgentSpawned", {
      agentName: entry.name,
      mode: "concurrent",
      pid: child.pid ?? -1,
      startedAt: handle.startedAt,
    });

    this.wireChildIPC(entry, child, handle);
  }

  private scheduleWarmRestart(entry: RegisteredAgent): void {
    if (this.restartingWarmAgents.has(entry.name)) return;
    this.restartingWarmAgents.add(entry.name);
    setTimeout(() => {
      this.restartingWarmAgents.delete(entry.name);
      if (this.stopping) return;
      // Reuse the previous handle's restart counter so the policy applies
      // across exits. We track it on the registry entry's `_warmRestarts`
      // counter (private field on the registry value).
      const prevRestarts =
        (entry as RegisteredAgent & { _warmRestarts?: number })
          ._warmRestarts ?? 0;
      if (prevRestarts >= this.warmRestartPolicy.maxRestarts) {
        this.emit("onAgentTerminated", {
          agentName: entry.name,
          reason: `Restart budget exhausted (${prevRestarts}/${this.warmRestartPolicy.maxRestarts})`,
          restartScheduled: false,
        });
        return;
      }
      (entry as RegisteredAgent & { _warmRestarts?: number })._warmRestarts =
        prevRestarts + 1;
      this.spawnWarmAgent(entry);
      this.emit("onAgentRestarted", {
        agentName: entry.name,
        restartCount: prevRestarts + 1,
      });
    }, this.warmRestartPolicy.backoffMs);
  }

  private async routeNotify(
    entry: RegisteredAgent,
    run: Run,
  ): Promise<void> {
    let handle = this.warmAgents.get(entry.name);
    if (!handle) {
      this.spawnWarmAgent(entry);
      handle = this.warmAgents.get(entry.name)!;
    }
    await this.adapter.updateRun(run.id, {
      status: "running",
      startedAt: new Date(),
      attempts: run.attempts + 1,
      lastRunAt: new Date(),
    });
    const fresh = (await this.adapter.getRun(run.id)) ?? run;
    handle.pendingNotifies.set(run.id, fresh);
    this.emit("onRunDispatched", { run: fresh });
    const input: unknown = JSON.parse(run.input);
    const envelope = { type: "notify" as const, runId: run.id, input };
    if (handle.ready) {
      try {
        handle.child.send(envelope);
        this.emit("onNotifyDelivered", { run: fresh });
      } catch (err) {
        handle.pendingNotifies.delete(run.id);
        await this.adapter.updateRun(run.id, {
          status: "failed",
          completedAt: new Date(),
          error: `Failed to deliver notify IPC: ${(err as Error).message}`,
        });
        this.emit("onRunFailed", {
          run: fresh,
          error: (err as Error).message,
        });
      }
    } else {
      handle.outboxQueue.push({ runId: run.id, input });
    }
  }

  // ── Triggered subprocess lifecycle ──────────────────────────────────────

  private dispatchTriggered(entry: RegisteredAgent, run: Run): void {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(entry.agent.env ?? {}),
      CONTINUUM_AGENT_FILE: entry.filePath,
      CONTINUUM_AGENT_NAME: run.agentName,
      CONTINUUM_MODE: "triggered",
      CONTINUUM_RUN_ID: run.id,
      CONTINUUM_INPUT_JSON: run.input,
      CONTINUUM_TIMEOUT: String(run.timeout ?? DEFAULT_TIMEOUT_MS),
    };
    const tsxImport = getTsxImport();
    const nodeArgs = tsxImport
      ? ["--import", tsxImport, BOOTSTRAP]
      : [BOOTSTRAP];
    const child = spawn("node", nodeArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    this.childByRunId.set(run.id, child);
    this.emit("onAgentSpawned", {
      agentName: entry.name,
      mode: "triggered",
      pid: child.pid ?? -1,
      startedAt: new Date(),
    });

    this.wireChildIPC(entry, child, null, run);
  }

  // ── Shared IPC wiring ──────────────────────────────────────────────────

  private wireChildIPC(
    entry: RegisteredAgent,
    child: ChildProcess,
    warm: WarmAgentHandle | null,
    triggeredRun?: Run,
  ): void {
    let resolved = !!warm; // for triggered, we resolve via run:completed/failed; for warm, run lifecycle is per-notify
    const runId = triggeredRun?.id;

    const cleanupTriggered = (): void => {
      if (runId) this.childByRunId.delete(runId);
    };

    child.on("message", async (raw: unknown) => {
      const msg = raw as ChildToParentMessage;
      if (!msg || typeof msg !== "object") return;
      await this.handleChildMessage(entry, msg, warm, () => {
        resolved = true;
      });
      if (
        triggeredRun &&
        (msg.type === "run:completed" || msg.type === "run:failed")
      ) {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.decrementPerAgent(entry.name);
        cleanupTriggered();
      }
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      this.emit("onLogOutput", {
        run: triggeredRun ?? null,
        agentName: entry.name,
        level: "stdout",
        message: chunk.toString(),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.emit("onLogOutput", {
        run: triggeredRun ?? null,
        agentName: entry.name,
        level: "stderr",
        message: chunk.toString(),
      });
    });

    child.on("error", (err) => {
      console.error(
        `[glove-continuum-signal] Failed to spawn process for "${entry.name}":`,
        err,
      );
      if (triggeredRun && !resolved) {
        resolved = true;
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.decrementPerAgent(entry.name);
        cleanupTriggered();
      }
      if (warm) {
        this.warmAgents.delete(entry.name);
        this.emit("onAgentTerminated", {
          agentName: entry.name,
          reason: `spawn error: ${err.message}`,
          restartScheduled: !this.stopping,
        });
        if (!this.stopping) this.scheduleWarmRestart(entry);
      }
    });

    child.on("exit", async () => {
      // H2: 200ms grace so any pending IPC messages get handled before we
      // decide whether to retry / fail / restart.
      await this.sleep(200);

      if (triggeredRun) {
        cleanupTriggered();
        if (!resolved) {
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.decrementPerAgent(entry.name);
        }
        if (resolved) return;
        const current = await this.adapter.getRun(triggeredRun.id);
        if (!current || current.status !== "running") return;
        const error = "Child process exited unexpectedly";
        const maxAttempts =
          triggeredRun.maxAttempts ?? this.defaultMaxAttempts;
        if (current.attempts < maxAttempts) {
          await this.adapter.updateRun(triggeredRun.id, {
            status: "pending",
            startedAt: undefined,
            lastRunAt: new Date(),
            error,
          });
          this.emit("onRunRetry", {
            run: current,
            attempt: current.attempts,
            maxAttempts,
          });
        } else {
          await this.adapter.updateRun(triggeredRun.id, {
            status: "failed",
            completedAt: new Date(),
            error,
          });
          this.emit("onRunFailed", { run: current, error });
        }
      }

      if (warm) {
        // Fail any pending notifies — their subprocess is gone.
        for (const pending of warm.pendingNotifies.values()) {
          const cur = await this.adapter.getRun(pending.id);
          if (!cur || cur.status !== "running") continue;
          await this.adapter.updateRun(pending.id, {
            status: "failed",
            completedAt: new Date(),
            error: "Warm subprocess exited mid-notify",
          });
          this.emit("onRunFailed", {
            run: cur,
            error: "Warm subprocess exited mid-notify",
          });
        }
        warm.pendingNotifies.clear();
        this.warmAgents.delete(entry.name);
        this.emit("onAgentTerminated", {
          agentName: entry.name,
          reason: "subprocess exited",
          restartScheduled: !this.stopping,
        });
        if (!this.stopping) this.scheduleWarmRestart(entry);
      }
    });
  }

  private async handleChildMessage(
    entry: RegisteredAgent,
    msg: ChildToParentMessage,
    warm: WarmAgentHandle | null,
    markResolved: () => void,
  ): Promise<void> {
    switch (msg.type) {
      case "ready": {
        if (warm) {
          warm.ready = true;
          this.emit("onAgentReady", { agentName: entry.name });
          // Flush queued notifies.
          for (const queued of warm.outboxQueue) {
            try {
              warm.child.send({
                type: "notify",
                runId: queued.runId,
                input: queued.input,
              });
              const run = await this.adapter.getRun(queued.runId);
              if (run) this.emit("onNotifyDelivered", { run });
            } catch (err) {
              warm.pendingNotifies.delete(queued.runId);
              await this.adapter.updateRun(queued.runId, {
                status: "failed",
                completedAt: new Date(),
                error: `Failed to flush notify IPC: ${(err as Error).message}`,
              });
            }
          }
          warm.outboxQueue.length = 0;
        }
        return;
      }
      case "run:started": {
        const current = await this.adapter.getRun(msg.runId);
        if (current) this.emit("onRunStarted", { run: current });
        return;
      }
      case "run:completed": {
        markResolved();
        const current = await this.adapter.getRun(msg.runId);
        if (
          current &&
          (current.status === "cancelled" || current.status === "failed")
        ) {
          return;
        }
        await this.adapter.updateRun(msg.runId, {
          status: "completed",
          completedAt: new Date(),
          output: msg.output,
        });
        const final = (await this.adapter.getRun(msg.runId)) ?? current;
        if (final) {
          this.emit("onRunCompleted", { run: final, output: msg.output });
        }
        return;
      }
      case "run:failed": {
        markResolved();
        const current = await this.adapter.getRun(msg.runId);
        if (
          current &&
          (current.status === "cancelled" || current.status === "failed")
        ) {
          return;
        }
        const attempts = current?.attempts ?? 0;
        const maxAttempts = current?.maxAttempts ?? this.defaultMaxAttempts;
        if (msg.retryable && attempts < maxAttempts) {
          await this.adapter.updateRun(msg.runId, {
            status: "pending",
            startedAt: undefined,
            lastRunAt: new Date(),
            error: msg.error,
          });
          if (current) {
            this.emit("onRunRetry", {
              run: current,
              attempt: attempts,
              maxAttempts,
            });
          }
        } else {
          await this.adapter.updateRun(msg.runId, {
            status: "failed",
            completedAt: new Date(),
            error: msg.error,
          });
          if (current) {
            this.emit("onRunFailed", { run: current, error: msg.error });
          }
        }
        return;
      }
      case "notify:started": {
        const current = await this.adapter.getRun(msg.runId);
        if (current) this.emit("onRunStarted", { run: current });
        return;
      }
      case "notify:completed": {
        if (warm) warm.pendingNotifies.delete(msg.runId);
        const current = await this.adapter.getRun(msg.runId);
        if (
          current &&
          (current.status === "cancelled" || current.status === "failed")
        ) {
          return;
        }
        await this.adapter.updateRun(msg.runId, {
          status: "completed",
          completedAt: new Date(),
          output: msg.output,
        });
        const final = (await this.adapter.getRun(msg.runId)) ?? current;
        if (final) {
          this.emit("onRunCompleted", { run: final, output: msg.output });
        }
        return;
      }
      case "notify:failed": {
        if (warm) warm.pendingNotifies.delete(msg.runId);
        const current = await this.adapter.getRun(msg.runId);
        if (
          current &&
          (current.status === "cancelled" || current.status === "failed")
        ) {
          return;
        }
        await this.adapter.updateRun(msg.runId, {
          status: "failed",
          completedAt: new Date(),
          error: msg.error,
        });
        if (current) {
          this.emit("onRunFailed", { run: current, error: msg.error });
        }
        return;
      }
      case "onComplete:error": {
        const current = await this.adapter.getRun(msg.runId);
        if (current) {
          this.emit("onCompleteError", { run: current, error: msg.error });
        }
        return;
      }
      case "agent:event": {
        const envelope: AgentEventEnvelope = {
          agentName: msg.agentName,
          runId: msg.runId,
          mode: entry.mode,
          event_type: msg.event_type,
          // The IPC envelope ferries event data as `unknown` since the union
          // would otherwise be unwieldy; subscribers narrow on `event_type`.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: msg.data as any,
          timestamp: msg.timestamp,
        };
        this.emit("onAgentEvent", envelope);
        return;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private scheduleRecurring(a: AnyAgent): void {
    if (a.mode !== "triggered" || !a.interval) return;
    const ms = parseInterval(a.interval);
    this.recurringSchedules.set(a.name, {
      agentName: a.name,
      interval: a.interval,
      nextRunAt: new Date(Date.now() + ms),
      timeout: a.timeout,
      maxAttempts: a.maxAttempts,
      input: a.recurringInput ? JSON.stringify(a.recurringInput) : undefined,
    });
  }

  private incrementPerAgent(name: string): void {
    this.activePerAgent.set(
      name,
      (this.activePerAgent.get(name) ?? 0) + 1,
    );
  }

  private decrementPerAgent(name: string): void {
    const cur = this.activePerAgent.get(name) ?? 0;
    if (cur <= 1) this.activePerAgent.delete(name);
    else this.activePerAgent.set(name, cur - 1);
  }

  private waitForAllChildren(signal: AbortSignal): Promise<void> {
    if (this.childByRunId.size === 0 && this.warmAgents.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolveOuter) => {
      const interval = setInterval(() => {
        if (
          (this.childByRunId.size === 0 && this.warmAgents.size === 0) ||
          signal.aborted
        ) {
          clearInterval(interval);
          resolveOuter();
        }
      }, 100);
      signal.addEventListener(
        "abort",
        () => {
          clearInterval(interval);
          resolveOuter();
        },
        { once: true },
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
  }

  private emit<K extends keyof ContinuumSubscriber>(
    event: K,
    data: Parameters<NonNullable<ContinuumSubscriber[K]>>[0],
  ): void {
    for (const sub of this.subscribers) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sub[event] as any)?.(data);
      } catch (err) {
        console.error(
          `[glove-continuum-signal] Subscriber error in ${String(event)}:`,
          err,
        );
      }
    }
  }
}

export type { IPCMessage };
