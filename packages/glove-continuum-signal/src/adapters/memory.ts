import { randomUUID } from "node:crypto";
import type { Run, RunPatch, RunStatus } from "../types.js";
import type { ContinuumAdapter } from "./index.js";
import { registerAdapter } from "./registry.js";

/**
 * In-process memory adapter. Useful for single-process scripts and tests.
 * Does NOT implement SerializableAdapter — distributed coordination is a
 * wrapper concern.
 */
export class MemoryAdapter implements ContinuumAdapter {
  private runs = new Map<string, Run>();
  private maxRuns: number;

  constructor(options?: { maxRuns?: number }) {
    this.maxRuns = options?.maxRuns ?? 10_000;
  }

  async addRun(run: Run): Promise<void> {
    this.runs.set(run.id, run);
    if (this.runs.size > this.maxRuns) {
      this.evictCompleted();
    }
  }

  private evictCompleted(): void {
    const terminal: string[] = [];
    for (const [id, run] of this.runs) {
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled"
      ) {
        terminal.push(id);
      }
    }
    terminal.sort((a, b) => {
      const ra = this.runs.get(a)!;
      const rb = this.runs.get(b)!;
      return (
        (ra.completedAt?.getTime() ?? 0) - (rb.completedAt?.getTime() ?? 0)
      );
    });
    const evictCount = Math.max(1, Math.floor(terminal.length * 0.1));
    for (let i = 0; i < evictCount && i < terminal.length; i++) {
      this.runs.delete(terminal[i]);
    }
  }

  async removeRun(id: string): Promise<void> {
    this.runs.delete(id);
  }

  async getRunsDue(): Promise<Run[]> {
    const now = new Date();
    return Array.from(this.runs.values())
      .filter((run) => {
        if (run.status !== "pending") return false;
        if (!run.nextRunAt) return true;
        return run.nextRunAt <= now;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getRunsRunning(): Promise<Run[]> {
    return Array.from(this.runs.values()).filter(
      (run) => run.status === "running",
    );
  }

  async getRun(id: string): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async updateRun(id: string, patch: RunPatch): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    const rec = run as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete rec[key];
      } else {
        rec[key] = value;
      }
    }
  }

  async listRuns(agentName: string): Promise<Run[]> {
    return Array.from(this.runs.values()).filter(
      (run) => run.agentName === agentName,
    );
  }

  async hasRunWithStatus(
    agentName: string,
    statuses: RunStatus[],
  ): Promise<boolean> {
    const statusSet = new Set(statuses);
    for (const run of this.runs.values()) {
      if (run.agentName === agentName && statusSet.has(run.status)) return true;
    }
    return false;
  }

  async purgeRuns(olderThan: Date, statuses: RunStatus[]): Promise<number> {
    const statusSet = new Set(statuses);
    let purged = 0;
    for (const [id, run] of this.runs) {
      if (
        statusSet.has(run.status) &&
        run.completedAt &&
        run.completedAt < olderThan
      ) {
        this.runs.delete(id);
        purged++;
      }
    }
    return purged;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  generateId(): string {
    return randomUUID();
  }

  async close(): Promise<void> {
    this.runs.clear();
  }
}

registerAdapter("memory", () => new MemoryAdapter());
