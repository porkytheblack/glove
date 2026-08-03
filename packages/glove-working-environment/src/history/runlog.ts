/**
 * Run history: every `run_script` invocation appends a JSONL line to
 * `/.env/history.jsonl`. The file is readable/grepable by the model like any
 * other file, and ring-buffered so it cannot grow unboundedly.
 */
import type { EnvLimits, Vfs } from "../types";

const HISTORY_PATH = "/.env/history.jsonl";

export interface RunLogEntry {
  id: string;
  ts: string;
  script: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
  resultPreview: string | null;
  spill: string | null;
  error?: string;
  /** Present only for test runs, so `history` can tell them from real work. */
  kind?: "test";
}

export class RunLog {
  private lines: string[] | null = null;
  private runCounter = 0;

  constructor(
    private vfs: Vfs,
    private limits: EnvLimits,
  ) {}

  nextRunId(): string {
    this.runCounter += 1;
    return `run_${Date.now().toString(36)}_${this.runCounter}`;
  }

  private async load(): Promise<string[]> {
    if (this.lines) return this.lines;
    if (await this.vfs.exists(HISTORY_PATH)) {
      const text = new TextDecoder().decode(await this.vfs.read(HISTORY_PATH));
      this.lines = text.split("\n").filter((l) => l.trim() !== "");
    } else {
      this.lines = [];
    }
    return this.lines;
  }

  async append(entry: RunLogEntry): Promise<void> {
    const lines = await this.load();
    lines.push(JSON.stringify(entry));
    // Ring by BOTH count and bytes: a count-only ring with large lines is
    // still unbounded, and this file is written outside the guarded gateway
    // (it is environment-owned, so the model's size caps don't apply to the
    // mutation itself) — it must therefore bound itself.
    while (lines.length > this.limits.maxHistoryLines) lines.shift();
    const maxBytes = Math.min(this.limits.maxFileBytes, Math.max(64 * 1024, this.limits.maxHistoryLines * 256));
    let bytes = lines.reduce((n, l) => n + l.length + 1, 0);
    while (lines.length > 1 && bytes > maxBytes) {
      bytes -= lines.shift()!.length + 1;
    }
    this.lines = lines;
    await this.vfs.write(HISTORY_PATH, new TextEncoder().encode(lines.join("\n") + "\n"));
  }

  async tail(limit: number): Promise<RunLogEntry[]> {
    const lines = await this.load();
    const out: RunLogEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as RunLogEntry);
      } catch {
        // skip corrupt lines
      }
    }
    return out;
  }
}
