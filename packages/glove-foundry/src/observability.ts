import { randomUUID } from "node:crypto";
import type { Run, SignalSubscriber } from "station-signal";
import { FOUNDRY_EVENT_PREFIX } from "./definition.js";

export type FoundryEventCategory =
  | "agent"
  | "run"
  | "model"
  | "tool"
  | "extension"
  | "application"
  | "inbox"
  | "memory"
  | "mcp"
  | "activation"
  | "system"
  | "log";

export interface FoundryEvent {
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: string;
  readonly category: FoundryEventCategory;
  readonly agent?: string;
  readonly runId?: string;
  readonly data: unknown;
}

export interface EventFilter {
  readonly after?: number;
  readonly agent?: string;
  readonly runId?: string;
  readonly category?: FoundryEventCategory;
  readonly limit?: number;
}

export interface FoundryObservabilityAdapter {
  append(
    event: Omit<FoundryEvent, "id" | "sequence" | "timestamp"> & {
      timestamp?: string;
    },
  ): FoundryEvent;
  list(filter?: EventFilter): FoundryEvent[];
  subscribe(listener: (event: FoundryEvent) => void): () => void;
  clear?(): void | Promise<void>;
}

export class MemoryObservabilityAdapter
  implements FoundryObservabilityAdapter
{
  private readonly maxEvents: number;
  private readonly events: FoundryEvent[] = [];
  private readonly listeners = new Set<(event: FoundryEvent) => void>();
  private sequence = 0;

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents ?? 10_000;
    if (!Number.isInteger(this.maxEvents) || this.maxEvents < 1) {
      throw new Error("maxEvents must be an integer >= 1");
    }
  }

  append(
    input: Omit<FoundryEvent, "id" | "sequence" | "timestamp"> & {
      timestamp?: string;
    },
  ): FoundryEvent {
    const event: FoundryEvent = Object.freeze({
      id: randomUUID(),
      sequence: ++this.sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      category: input.category,
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      data: input.data,
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    for (const listener of this.listeners) listener(event);
    return event;
  }

  list(filter: EventFilter = {}): FoundryEvent[] {
    const matched = this.events.filter((event) => {
      if (filter.after !== undefined && event.sequence <= filter.after) {
        return false;
      }
      if (filter.agent && event.agent !== filter.agent) return false;
      if (filter.runId && event.runId !== filter.runId) return false;
      if (filter.category && event.category !== filter.category) return false;
      return true;
    });
    const limit = Math.max(1, Math.min(filter.limit ?? 500, 5_000));
    return matched.slice(-limit);
  }

  subscribe(listener: (event: FoundryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.events.length = 0;
  }
}

function categoryForAgentEvent(type: string): FoundryEventCategory {
  if (type.startsWith("tool_")) return "tool";
  if (type.startsWith("foundry.installation")) return "application";
  if (
    type.startsWith("foundry.layer") ||
    type.startsWith("foundry.subscriber")
  ) {
    return "extension";
  }
  if (type.startsWith("glove_memory") || type.startsWith("glove_context")) {
    return "memory";
  }
  if (type.startsWith("mcp") || type.includes("discovermcp")) return "mcp";
  if (type.startsWith("inbox")) return "inbox";
  if (
    type.startsWith("hook_") ||
    type.startsWith("skill_") ||
    type.startsWith("subagent_")
  ) {
    return "extension";
  }
  if (
    type === "text_delta" ||
    type.startsWith("model_") ||
    type === "token_consumption"
  ) {
    return "model";
  }
  return "system";
}

interface EncodedAgentEvent {
  readonly type: string;
  readonly data: unknown;
  readonly timestamp?: string;
}

function encodedAgentEvent(message: string): EncodedAgentEvent | null {
  const start = message.indexOf(FOUNDRY_EVENT_PREFIX);
  if (start < 0) return null;
  const json = message.slice(start + FOUNDRY_EVENT_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(json) as Partial<EncodedAgentEvent>;
    return typeof parsed.type === "string"
      ? { type: parsed.type, data: parsed.data, timestamp: parsed.timestamp }
      : null;
  } catch {
    return null;
  }
}

/** Internal bridge from the execution backend into Foundry's event vocabulary. */
export class FoundryObserver implements SignalSubscriber {
  private readonly logBuffers = new Map<string, string>();

  constructor(
    private readonly adapter: FoundryObservabilityAdapter,
    private readonly routeForSignalName: (name: string) => string,
    private readonly onAgentEvent?: (event: {
      readonly route: string;
      readonly run: Run;
      readonly type: string;
      readonly data: unknown;
    }) => void,
  ) {}

  private route(name: string): string {
    return this.routeForSignalName(name);
  }

  private runEvent(type: string, run: Run, data: unknown = {}): void {
    this.adapter.append({
      type,
      category: "run",
      agent: this.route(run.signalName),
      runId: run.id,
      data,
    });
  }

  onSignalDiscovered(event: { signalName: string; filePath: string }): void {
    this.adapter.append({
      type: "agent.discovered",
      category: "agent",
      agent: this.route(event.signalName),
      data: { runtime: "foundry-execution", filePath: event.filePath },
    });
  }

  onRunDispatched({ run }: { run: Run }): void {
    this.runEvent("run.dispatched", run);
  }

  onRunStarted({ run }: { run: Run }): void {
    this.runEvent("run.started", run);
  }

  onRunCompleted(event: { run: Run; output?: string }): void {
    this.flushRunLogs(event.run);
    this.runEvent("run.completed", event.run, { output: event.output });
  }

  onRunTimeout({ run }: { run: Run }): void {
    this.runEvent("run.timeout", run);
  }

  onRunRetry(event: {
    run: Run;
    attempt: number;
    maxAttempts: number;
  }): void {
    this.runEvent("run.retry", event.run, {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
    });
  }

  onRunFailed(event: { run: Run; error?: string }): void {
    this.flushRunLogs(event.run);
    this.runEvent("run.failed", event.run, { error: event.error });
  }

  onRunCancelled({ run }: { run: Run }): void {
    this.flushRunLogs(run);
    this.runEvent("run.cancelled", run);
  }

  onRunSkipped(event: { run: Run; reason: string }): void {
    this.runEvent("run.skipped", event.run, { reason: event.reason });
  }

  onRunRescheduled(event: { run: Run; nextRunAt: Date }): void {
    this.runEvent("run.rescheduled", event.run, {
      nextRunAt: event.nextRunAt.toISOString(),
    });
  }

  onCompleteError(event: { run: Run; error: string }): void {
    this.runEvent("run.on-complete-error", event.run, { error: event.error });
  }

  onLogOutput(event: {
    run: Run;
    level: "stdout" | "stderr";
    message: string;
  }): void {
    const key = `${event.run.id}:${event.level}`;
    const combined = `${this.logBuffers.get(key) ?? ""}${event.message}`;
    const lines = combined.split(/\r?\n/);
    const complete = combined.endsWith("\n") ? lines : lines.slice(0, -1);
    const remainder = combined.endsWith("\n") ? "" : lines.at(-1) ?? "";
    if (remainder) this.logBuffers.set(key, remainder);
    else this.logBuffers.delete(key);
    for (const line of complete) {
      if (line) this.appendLogLine(event.run, event.level, line);
    }
  }

  private appendLogLine(
    run: Run,
    level: "stdout" | "stderr",
    message: string,
  ): void {
    const encoded = encodedAgentEvent(message);
    if (encoded) {
      this.onAgentEvent?.({
        route: this.route(run.signalName),
        run,
        type: encoded.type,
        data: encoded.data,
      });
      this.adapter.append({
        type: `agent.${encoded.type}`,
        category: categoryForAgentEvent(encoded.type),
        agent: this.route(run.signalName),
        runId: run.id,
        ...(encoded.timestamp ? { timestamp: encoded.timestamp } : {}),
        data: encoded.data,
      });
      return;
    }
    this.adapter.append({
      type: `log.${level}`,
      category: "log",
      agent: this.route(run.signalName),
      runId: run.id,
      data: { message },
    });
  }

  private flushRunLogs(run: Run): void {
    for (const level of ["stdout", "stderr"] as const) {
      const key = `${run.id}:${level}`;
      const remainder = this.logBuffers.get(key);
      if (!remainder) continue;
      this.logBuffers.delete(key);
      this.appendLogLine(run, level, remainder);
    }
  }

}
