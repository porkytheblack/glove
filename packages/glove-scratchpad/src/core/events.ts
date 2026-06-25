/**
 * Scratchpad observability — a subscribable event stream over every store
 * operation, modelled on glove-core's `SubscriberAdapter`.
 *
 * The scratchpad is the deterministic datapath of a multi-agent workflow; when a
 * run spans many MCP providers you want to *see* it work — what got contained,
 * what SQL narrowed it, what crossed back into context at the last mile, and what
 * failed. Subscribe with {@link Scratchpad.subscribe} and you get one event per
 * operation.
 *
 * ```ts
 * const off = sp.subscribe({
 *   record(ev) {
 *     if (ev.type === "materialize") console.log(`last-mile read: ${ev.returned} rows`);
 *   },
 * });
 * ```
 */
import type { Reference } from "./types";

export type ScratchpadOp = "ingest" | "query" | "materialize" | "drop" | "snapshot";

/**
 * One event per scratchpad operation. `durationMs` is wall-clock for the op.
 * `materialize` is the one to watch — it's the only event where real values
 * cross back into the model's context.
 */
export type ScratchpadEvent =
  | {
      type: "ingest";
      ref: Reference;
      rowCount: number;
      /** Payload bytes written to the store (kept out of context). */
      bytes: number;
      source: string;
      actor?: string;
      durationMs: number;
    }
  | {
      type: "query";
      sql: string;
      /** Set when the result was persisted (`store`) — the new reference. */
      stored?: Reference;
      /** Rows produced (returned in read mode, or row count of the stored table). */
      rows: number;
      truncated: boolean;
      durationMs: number;
    }
  | {
      type: "materialize";
      ref?: Reference;
      sql?: string;
      /** Rows that crossed into context. */
      returned: number;
      truncated: boolean;
      durationMs: number;
    }
  | { type: "drop"; ref: Reference; durationMs: number }
  | { type: "snapshot"; bytes: number; durationMs: number }
  | { type: "error"; op: ScratchpadOp; message: string; sql?: string; ref?: Reference };

/** A scratchpad observer. `record` is awaited, mirroring glove's subscriber. */
export interface ScratchpadSubscriber {
  record(event: ScratchpadEvent): void | Promise<void>;
}

// ─── A ready-made stats collector ────────────────────────────────────────────

export interface ScratchpadStats {
  ingests: number;
  queries: number;
  materializes: number;
  drops: number;
  snapshots: number;
  errors: number;
  /** Payload bytes contained across all ingests. */
  bytesIngested: number;
  /** Rows that crossed into context across all materializes. */
  rowsMaterialized: number;
}

export interface ScratchpadStatsCollector {
  /** Pass to {@link Scratchpad.subscribe}. */
  readonly subscriber: ScratchpadSubscriber;
  stats(): ScratchpadStats;
  /** One-line summary, e.g. `5 ingests (188 KB) · 9 queries · 3 materializes (24 rows) · 0 errors`. */
  format(): string;
  reset(): void;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A {@link ScratchpadSubscriber} that tallies operations — instant observability
 * over a run without writing your own counters.
 */
export function createScratchpadStats(): ScratchpadStatsCollector {
  const s: ScratchpadStats = {
    ingests: 0,
    queries: 0,
    materializes: 0,
    drops: 0,
    snapshots: 0,
    errors: 0,
    bytesIngested: 0,
    rowsMaterialized: 0,
  };
  const subscriber: ScratchpadSubscriber = {
    record(ev) {
      switch (ev.type) {
        case "ingest":
          s.ingests++;
          s.bytesIngested += ev.bytes;
          break;
        case "query":
          s.queries++;
          break;
        case "materialize":
          s.materializes++;
          s.rowsMaterialized += ev.returned;
          break;
        case "drop":
          s.drops++;
          break;
        case "snapshot":
          s.snapshots++;
          break;
        case "error":
          s.errors++;
          break;
      }
    },
  };
  return {
    subscriber,
    stats: () => ({ ...s }),
    format: () =>
      `${s.ingests} ingest(s) (${humanBytes(s.bytesIngested)}) · ${s.queries} quer${s.queries === 1 ? "y" : "ies"} · ` +
      `${s.materializes} materialize(s) (${s.rowsMaterialized} rows) · ${s.errors} error(s)`,
    reset: () => {
      s.ingests = s.queries = s.materializes = s.drops = s.snapshots = s.errors = 0;
      s.bytesIngested = s.rowsMaterialized = 0;
    },
  };
}
