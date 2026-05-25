import type { AgentMode, Run } from "../types.js";
import type { AgentEventEnvelope, ContinuumSubscriber } from "./index.js";

export class ConsoleSubscriber implements ContinuumSubscriber {
  private prefix = "[glove-continuum]";

  onAgentDiscovered(event: {
    agentName: string;
    mode: AgentMode;
    filePath: string;
  }): void {
    console.log(
      `${this.prefix} Discovered ${event.mode} agent "${event.agentName}" at ${event.filePath}`,
    );
  }

  onAgentSpawned(event: {
    agentName: string;
    mode: AgentMode;
    pid: number;
    startedAt: Date;
  }): void {
    console.log(
      `${this.prefix} Spawned ${event.mode} agent "${event.agentName}" (pid ${event.pid})`,
    );
  }

  onAgentReady(event: { agentName: string }): void {
    console.log(`${this.prefix} Ready "${event.agentName}"`);
  }

  onAgentTerminated(event: {
    agentName: string;
    reason: string;
    restartScheduled: boolean;
  }): void {
    const tail = event.restartScheduled
      ? " (restart scheduled)"
      : " (no restart)";
    console.warn(
      `${this.prefix} Terminated "${event.agentName}": ${event.reason}${tail}`,
    );
  }

  onAgentRestarted(event: {
    agentName: string;
    restartCount: number;
  }): void {
    console.log(
      `${this.prefix} Restarted "${event.agentName}" (restart #${event.restartCount})`,
    );
  }

  onRunDispatched(event: { run: Run }): void {
    console.log(
      `${this.prefix} Dispatched "${event.run.agentName}" (${event.run.id}, kind=${event.run.kind})`,
    );
  }

  onRunStarted(event: { run: Run }): void {
    console.log(
      `${this.prefix} Started "${event.run.agentName}" (${event.run.id})`,
    );
  }

  onRunCompleted(event: { run: Run; output?: string }): void {
    const outputStr = event.output
      ? ` → ${
          event.output.length > 200
            ? event.output.slice(0, 200) + "…"
            : event.output
        }`
      : "";
    console.log(
      `${this.prefix} Completed "${event.run.agentName}" (${event.run.id})${outputStr}`,
    );
  }

  onRunTimeout(event: { run: Run }): void {
    console.warn(
      `${this.prefix} Timeout "${event.run.agentName}" (${event.run.id})`,
    );
  }

  onRunRetry(event: {
    run: Run;
    attempt: number;
    maxAttempts: number;
  }): void {
    console.log(
      `${this.prefix} Retry "${event.run.agentName}" (${event.run.id}) — attempt ${event.attempt}/${event.maxAttempts}`,
    );
  }

  onRunFailed(event: { run: Run; error?: string }): void {
    console.error(
      `${this.prefix} Failed "${event.run.agentName}" (${event.run.id})${
        event.error ? `: ${event.error}` : ""
      }`,
    );
  }

  onRunCancelled(event: { run: Run }): void {
    console.log(
      `${this.prefix} Cancelled "${event.run.agentName}" (${event.run.id})`,
    );
  }

  onRunSkipped(event: { run: Run; reason: string }): void {
    console.log(
      `${this.prefix} Skipped "${event.run.agentName}" (${event.run.id}): ${event.reason}`,
    );
  }

  onRunRescheduled(event: { run: Run; nextRunAt: Date }): void {
    console.log(
      `${this.prefix} Rescheduled "${event.run.agentName}" (${event.run.id}) — next at ${event.nextRunAt.toISOString()}`,
    );
  }

  onNotifyDelivered(event: { run: Run }): void {
    console.log(
      `${this.prefix} Notify delivered "${event.run.agentName}" (${event.run.id})`,
    );
  }

  onCompleteError(event: { run: Run; error: string }): void {
    console.error(
      `${this.prefix} onComplete handler failed for "${event.run.agentName}" (${event.run.id}): ${event.error}`,
    );
  }

  onLogOutput(event: {
    run: Run | null;
    agentName: string;
    level: "stdout" | "stderr";
    message: string;
  }): void {
    const lines = event.message.trimEnd();
    if (!lines) return;
    const method = event.level === "stderr" ? console.error : console.log;
    method(`${this.prefix} [${event.agentName}] ${lines}`);
  }

  onAgentEvent(envelope: AgentEventEnvelope): void {
    // Compact one-line summaries for common event types.
    switch (envelope.event_type) {
      case "text_delta": {
        const data = envelope.data as { text: string };
        process.stdout.write(data.text);
        return;
      }
      case "tool_use": {
        const data = envelope.data as { name: string };
        console.log(
          `${this.prefix} [${envelope.agentName}] tool: ${data.name}`,
        );
        return;
      }
      case "model_response_complete": {
        process.stdout.write("\n");
        return;
      }
    }
  }
}
