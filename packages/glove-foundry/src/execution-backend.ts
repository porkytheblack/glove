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

/** The daemon went away (disconnected or exited) with requests still pending. */
export class DaemonDisconnectedError extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The end of what the daemon wrote to stderr, with known secret values masked. */
  readonly stderrTail: string;
  constructor(exitCode: number | null, signal: NodeJS.Signals | null, stderrTail: string) {
    const how = exitCode !== null ? ` (exit code ${exitCode})` : signal ? ` (signal ${signal})` : "";
    super(`Foundry execution daemon disconnected${how}. A pending mutation may have completed; inspect state before retrying.`);
    this.name = "DaemonDisconnectedError";
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = stderrTail;
  }
}

const STDERR_TAIL_BYTES = 4096;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

/** Mask the values of secret-looking variables (keys, tokens, passwords) before keeping the daemon's output. */
function redactor(env: Record<string, string | undefined>): (text: string) => string {
  const values = Object.entries(env)
    .filter(([name, value]) => typeof value === "string" && value.length >= 8 && SECRET_NAME.test(name))
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  return (text) => values.reduce((out, value) => out.split(value).join("[redacted]"), text);
}

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
  private stderrTail = "";
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
    // Only the end of stderr is kept, masked, for the error when the daemon goes away.
    const redact = redactor(env);
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = redact((this.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES * 2)).slice(-STDERR_TAIL_BYTES);
    });
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
      const error = new DaemonDisconnectedError(child.exitCode, child.signalCode, this.stderrTail);
      // Going away unasked is a crash: say why on the host's stderr, masked, so it can be diagnosed.
      if (!this.stopped && error.stderrTail) process.stderr.write(`${error.message}\nThe daemon's last output:\n${error.stderrTail}\n`);
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
          try {
            if (child.connected) await this.request({ method: "stop" }, 15000);
          } catch (error) {
            // Asked to stop, the daemon going away is the stop finishing (#208). Its own
            // "stop failed" answer, or no answer while still connected, still throws.
            if (!(error instanceof DaemonDisconnectedError)) throw error;
          } finally {
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
  triggerSignal(name: string, input: unknown, options: { parked?: boolean } = {}): Promise<string> {
    return this.request({ method: "trigger", name, input, ...(options.parked ? { parked: true } : {}) });
  }
  /** Make a parked run due, with the input it should start from. False when it is no longer pending. */
  releaseRun(id: string, input: unknown): Promise<boolean> { return this.request({ method: "release", id, input }); }
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
