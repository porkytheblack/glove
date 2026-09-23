import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Run } from "station-signal";
import type { Schedule } from "station-schedules";
import type { FoundryObserver } from "./observability.js";
import { executionEvents, type DaemonCommand, type DaemonInit, type DaemonResponse } from "./execution-protocol.js";

function entry(name: string) {
  const built = fileURLToPath(new URL(`./${name}.js`, import.meta.url));
  return existsSync(built) ? built : fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
}
/** Private transport. Foundry never constructs or runs a SignalRunner. */
export class FoundryExecutionBackend {
  private child?: ChildProcess;
  private directory?: string;
  private sequence = 0;
  private stopped = false;
  private stopping?: Promise<void>;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private loopResolve?: () => void;
  private loopReject?: (error: Error) => void;
  private loop?: Promise<void>;
  constructor(private readonly options: Omit<DaemonInit, "directory" | "loader"> & { env: Record<string, string>; observer: FoundryObserver }) {}
  get processId(): number | undefined { return this.child?.pid; }
  async initialize() {
    if (this.child || this.stopped) throw new Error("Execution backend cannot be initialized twice.");
    this.directory = await mkdtemp(join(tmpdir(), "glove-foundry-daemon-"));
    const env = { ...process.env, ...this.options.env };
    for (const name of ["NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES"]) delete env[name];
    const child = this.child = fork(entry("execution-daemon"), [], {
      cwd: this.options.rootDir, env, serialization: "advanced",
      execArgv: ["--import", import.meta.resolve("tsx")], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    // Keep raw daemon diagnostics out of retained Foundry events; errors at this
    // boundary are deliberately generic. The parent never receives credentials.
    child.stderr?.resume();
    this.loop = new Promise<void>((resolve, reject) => { this.loopResolve = resolve; this.loopReject = reject; });
    void this.loop.catch(() => {});
    child.on("message", (message: DaemonResponse) => {
      if ("event" in message) {
        if (executionEvents.includes(message.event)) {
          const handler = this.options.observer[message.event] as (value: unknown) => void;
          handler.call(this.options.observer, message.value);
        }
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value);
    });
    const failed = () => {
      const error = new Error("Foundry execution daemon disconnected. A pending mutation may have completed; inspect state before retrying.");
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      if (this.stopped) this.loopResolve?.(); else this.loopReject?.(error);
    };
    child.once("error", failed); child.once("exit", failed); child.once("disconnect", failed);
    try {
      await this.request({ method: "init", options: {
        rootDir: this.options.rootDir, directory: this.directory, loader: entry("execution-loader"),
        agents: this.options.agents, runner: this.options.runner,
      } }, 60000);
    } catch (error) { await this.stop(); throw error; }
  }
  private request<T>(command: DaemonCommand, timeout = 30000): Promise<T> {
    if (!this.child?.connected || (this.stopped && command.method !== "stop")) return Promise.reject(new Error("Execution daemon is unavailable."));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Execution daemon request timed out. Its outcome may be unknown; do not automatically retry mutations.")); }, timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child!.send({ id, command }, error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error("Execution daemon request could not be delivered.")); }
      });
    });
  }
  start(): Promise<void> { return this.loop ?? Promise.reject(new Error("Execution backend is not initialized.")); }
  stop(_options?: { graceful: boolean; timeoutMs: number }): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = (async () => {
      const child = this.child;
      try {
        if (child) {
          try { if (child.connected) await this.request({ method: "stop" }, 15000); }
          finally {
            if (child.exitCode === null && child.signalCode === null) {
              await new Promise<void>(resolve => {
                const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
                child.once("exit", () => { clearTimeout(timer); resolve(); });
                if (child.connected) child.disconnect();
              });
            }
          }
        }
      } finally {
        if (this.directory) await rm(this.directory, { recursive: true, force: true });
      }
    })();
    return this.stopping;
  }
  triggerSignal(name: string, input: unknown): Promise<string> { return this.request({ method: "trigger", name, input }); }
  getRun(id: string): Promise<Run | null> { return this.request({ method: "get", id }); }
  listAllRuns(options: { signalName?: string } = {}): Promise<Run[]> { return this.request({ method: "list", ...options }); }
  cancel(id: string): Promise<boolean> { return this.request({ method: "cancel", id }); }
  ping(): Promise<boolean> { return this.request({ method: "ping" }); }
  getAdapter() { return { ping: () => this.ping() }; }
  readonly schedules = {
    add: (schedule: Schedule): Promise<void> => this.request({ method: "schedule.add", schedule }),
    delete: (id: string): Promise<boolean> => this.request({ method: "schedule.delete", id }),
    ping: () => this.ping(),
  };
  async waitForRun(id: string, options: { pollMs?: number; timeoutMs?: number } = {}): Promise<Run | null> {
    const deadline = Date.now() + (options.timeoutMs ?? 60000);
    do {
      const run = await this.getRun(id);
      if (!run || ["completed", "failed", "cancelled"].includes(run.status)) return run;
      await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 100));
    } while (Date.now() < deadline);
    return this.getRun(id);
  }
}
