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
      /** Payload bytes written to the store (kept OUT of context — the saving). */
      bytes: number;
      /** Bytes of the compact stub the model sees in place of the payload. */
      stubBytes: number;
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
      /** Bytes the model sees: the returned rows in read mode, or the stub in store mode. */
      bytes: number;
      truncated: boolean;
      durationMs: number;
    }
  | {
      type: "materialize";
      ref?: Reference;
      sql?: string;
      /** Rows that crossed into context. */
      returned: number;
      /** Bytes that crossed into context. */
      bytes: number;
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
  /** One-line summary, e.g. `5 ingest(s) (163.4 KB) · 1 query · 2 materialize(s) (9 rows) · 0 error(s)`. */
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

// ─── Token-consumption tracker ───────────────────────────────────────────────

/** Estimate the model tokens a serialised payload of `bytes` occupies. */
export type TokensForBytes = (bytes: number) => number;

/** Default heuristic: ~4 bytes per token (reasonable for JSON / English). */
export const defaultTokensForBytes: TokensForBytes = (bytes) => Math.ceil(bytes / 4);

export interface ScratchpadConsumption {
  /** Estimated tokens that crossed INTO the model's context via the scratchpad. */
  tokensIntoContext: number;
  /** Estimated tokens KEPT OUT of context by containment (the saving). */
  tokensContained: number;
  bytesIntoContext: number;
  bytesContained: number;
  /** Where the in-context tokens went. */
  byOp: {
    /** Stubs that replaced contained payloads. */
    stubs: number;
    /** Materialized rows (the deliberate last-mile loads). */
    materializes: number;
    /** Read-mode query rows / narrowed-result stubs. */
    queryReads: number;
  };
  /** tokensContained / tokensIntoContext — how much the scratchpad stretches your context budget. */
  reductionFactor: number;
}

export interface ConsumptionTracker {
  /** Pass to {@link Scratchpad.subscribe}. */
  readonly subscriber: ScratchpadSubscriber;
  report(): ScratchpadConsumption;
  /** One-line summary, e.g. `~3.3k tokens into context · ~41.8k contained (12.8× budget)`. */
  format(): string;
  reset(): void;
}

function humanTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * A {@link ScratchpadSubscriber} that estimates TOKEN consumption on the
 * scratchpad computer: tokens that crossed into the model's context (stubs +
 * materialized rows + read-mode query rows) versus tokens kept out by
 * containment. Subscribe it and read `report()` / `format()`.
 *
 * Tokens are estimated from serialised bytes via `tokensForBytes` (default
 * ~4 bytes/token); pass your model's ratio — or a tokenizer-backed estimate —
 * for a tighter number.
 *
 * ```ts
 * const consumption = createConsumptionTracker();
 * sp.subscribe(consumption.subscriber);
 * // …later: console.log(consumption.format());
 * //   → "~3.3k tokens into context · ~41.8k contained (12.8× budget)"
 * ```
 */
export function createConsumptionTracker(
  tokensForBytes: TokensForBytes = defaultTokensForBytes,
): ConsumptionTracker {
  let stubBytes = 0;
  let materializeBytes = 0;
  let queryBytes = 0;
  let containedBytes = 0;

  const subscriber: ScratchpadSubscriber = {
    record(ev) {
      switch (ev.type) {
        case "ingest":
          containedBytes += ev.bytes;
          stubBytes += ev.stubBytes;
          break;
        case "materialize":
          materializeBytes += ev.bytes;
          break;
        case "query":
          queryBytes += ev.bytes;
          break;
      }
    },
  };

  const report = (): ScratchpadConsumption => {
    const stubs = tokensForBytes(stubBytes);
    const materializes = tokensForBytes(materializeBytes);
    const queryReads = tokensForBytes(queryBytes);
    const tokensIntoContext = stubs + materializes + queryReads;
    const tokensContained = tokensForBytes(containedBytes);
    return {
      tokensIntoContext,
      tokensContained,
      bytesIntoContext: stubBytes + materializeBytes + queryBytes,
      bytesContained: containedBytes,
      byOp: { stubs, materializes, queryReads },
      reductionFactor: tokensIntoContext > 0 ? tokensContained / tokensIntoContext : Infinity,
    };
  };

  return {
    subscriber,
    report,
    format: () => {
      const r = report();
      const factor = r.tokensIntoContext > 0 ? `${r.reductionFactor.toFixed(1)}× budget` : "n/a";
      return `~${humanTokens(r.tokensIntoContext)} tokens into context · ~${humanTokens(r.tokensContained)} contained (${factor})`;
    },
    reset: () => {
      stubBytes = materializeBytes = queryBytes = containedBytes = 0;
    },
  };
}
