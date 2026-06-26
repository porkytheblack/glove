/**
 * Store-and-truncate (§3, §11) — result containment.
 *
 * Wraps any tool so its full result is written into the scratchpad and only a
 * stub (reference + descriptor + "read more") crosses back into the model's
 * context. This is the single most important integration point: it is where
 * result containment physically happens.
 *
 * It is deliberately generic over `GloveFoldArgs` (glove-core only), not coupled
 * to MCP — wrap a bridged MCP tool, an OpenAPI tool, or a hand-rolled `fold`
 * the same way. For MCP, compose with glove-mcp's `bridgeMcpTool`:
 *
 * ```ts
 * glove.fold(storeAndTruncate(bridgeMcpTool(conn, tool, serverMode), { scratchpad }));
 * ```
 *
 * To bridge + contain an entire MCP server in one call, see
 * `mountContainedMcp` on the `glove-scratchpad/mcp` subpath. To wrap a batch of
 * already-built tools, see `containTools` / `mountContainedTools`.
 */
import type { GloveFoldArgs } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { Scratchpad } from "../core/scratchpad";
import type { Stub } from "../core/types";

/**
 * Reported once per successful containment. The savings are the headline number
 * for this whole architecture: `bytesContained` never reaches the model;
 * `bytesEmitted` (the stub) is all that crosses into context.
 */
export interface ContainmentInfo {
  /** Name of the wrapped tool whose result was contained. */
  tool: string;
  /** Reference the payload was stored under. */
  ref: string;
  /** Rows in the stored root table. */
  rowCount: number;
  /** Bytes of the full payload — kept OUT of the model's context. */
  bytesContained: number;
  /** Bytes of the stub that crossed INTO the model's context. */
  bytesEmitted: number;
}

export type ContainmentListener = (info: ContainmentInfo) => void;

export interface StoreAndTruncateOptions {
  scratchpad: Scratchpad;
  /** Stamped into provenance as the actor (e.g. the subagent's name). */
  actor?: string;
  /** Base name for stored records. Defaults to the wrapped tool's name. */
  name?: string;
  /**
   * Only intercept payloads at least this many serialised bytes. Smaller
   * results pass through untouched (cheaper to just let the model see them).
   * Default 0 — always contain successful payloads.
   */
  minBytes?: number;
  /**
   * Keep the original payload on `renderData` (client-only, stripped before the
   * model) so UIs can still show full results. Default true.
   */
  keepRenderData?: boolean;
  /**
   * Notified after each successful containment with the byte savings. Use it
   * for telemetry / "is the scratchpad earning its keep?" dashboards. See
   * {@link createContainmentReporter} for a ready-made aggregator.
   */
  onContain?: ContainmentListener;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Reduce a tool's `data` to a JSON value plus the string it serialises to.
 * Bridged tools commonly return a JSON *string* in `data`; parse it so the
 * store can normalize the real structure, falling back to a text record.
 */
function coercePayload(data: unknown): { value: unknown; rawString: string } {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return { value: JSON.parse(trimmed), rawString: data };
      } catch {
        /* not JSON — treat as text */
      }
    }
    return { value: data, rawString: data };
  }
  return { value: data, rawString: JSON.stringify(data) ?? "" };
}

/** The compact, model-facing shape of a stub — a descriptor, never a payload. */
export function stubData(stub: Stub): {
  scratchpad: true;
  ref: string;
  kind: Stub["descriptor"]["kind"];
  rowCount: number;
  rawBytes?: number;
  columns: { name: string; type: string }[];
  tables: { table: string; role: string; rowCount: number; parentField?: string }[];
  preview: Record<string, unknown>[];
  provenance: Stub["descriptor"]["provenance"];
  readMore: string;
} {
  const d = stub.descriptor;
  return {
    scratchpad: true,
    ref: stub.ref,
    kind: d.kind,
    rowCount: d.rowCount,
    rawBytes: d.rawBytes,
    columns: d.columns.map((c) => ({ name: c.name, type: c.type })),
    tables: d.tables.map((t) => ({
      table: t.table,
      role: t.role,
      rowCount: t.rowCount,
      parentField: t.parent?.field,
    })),
    preview: d.preview,
    provenance: d.provenance,
    readMore: stub.readMore,
  };
}

export function storeAndTruncate<I>(
  tool: GloveFoldArgs<I>,
  opts: StoreAndTruncateOptions,
): GloveFoldArgs<I> {
  const baseName = opts.name ?? tool.name;
  return {
    ...tool,
    async do(input, display, glove, signal): Promise<ToolResultData> {
      const result = await tool.do(input, display, glove, signal);
      if (result.status !== "success" || result.data == null) return result;

      const { value, rawString } = coercePayload(result.data);
      if (opts.minBytes && byteLength(rawString) < opts.minBytes) return result;

      const stub = await opts.scratchpad.ingest(value, {
        name: baseName,
        provenance: { source: `tool:${tool.name}`, actor: opts.actor },
      });

      const model = stubData(stub);

      if (opts.onContain) {
        try {
          opts.onContain({
            tool: tool.name,
            ref: stub.ref,
            rowCount: stub.descriptor.rowCount,
            bytesContained: byteLength(rawString),
            bytesEmitted: byteLength(JSON.stringify(model)),
          });
        } catch {
          // Telemetry must never turn a successful containment into a failed
          // tool call — a throwing listener here would force a retry and leave
          // a duplicate stored ref behind.
        }
      }

      return {
        ...result,
        status: "success",
        data: model,
        renderData:
          result.renderData ??
          (opts.keepRenderData === false ? undefined : result.data),
      };
    },
  };
}

// ─── Containment telemetry ───────────────────────────────────────────────────

export interface ContainmentReport {
  /** Number of successful containments observed. */
  calls: number;
  /** Total payload bytes kept out of context. */
  bytesContained: number;
  /** Total stub bytes that entered context. */
  bytesEmitted: number;
  /** `bytesContained / bytesEmitted` (Infinity when nothing was emitted yet). */
  reductionFactor: number;
  /** Per-tool breakdown. */
  byTool: Record<string, { calls: number; bytesContained: number; bytesEmitted: number }>;
}

export interface ContainmentReporter {
  /** Pass as `onContain` to `storeAndTruncate` / `mountContained*`. */
  readonly onContain: ContainmentListener;
  /** Snapshot the running totals. */
  report(): ContainmentReport;
  /** One-line human summary, e.g. `5 call(s) · 163.4 KB contained → 5.5 KB emitted (30.0× less)`. */
  format(): string;
  /** Reset all counters. */
  reset(): void;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A ready-made {@link ContainmentListener} that aggregates byte savings across
 * many contained calls. Productionises the "prove the scratchpad is saving
 * context" accounting you'd otherwise hand-roll off the subscriber stream.
 *
 * ```ts
 * const reporter = createContainmentReporter();
 * await mountContainedMcp(agent, conn, { scratchpad: sp, onContain: reporter.onContain });
 * // …after the run:
 * console.log(reporter.format());
 * ```
 */
export function createContainmentReporter(): ContainmentReporter {
  let calls = 0;
  let bytesContained = 0;
  let bytesEmitted = 0;
  const byTool: ContainmentReport["byTool"] = {};

  const onContain: ContainmentListener = (info) => {
    calls++;
    bytesContained += info.bytesContained;
    bytesEmitted += info.bytesEmitted;
    const t = (byTool[info.tool] ??= { calls: 0, bytesContained: 0, bytesEmitted: 0 });
    t.calls++;
    t.bytesContained += info.bytesContained;
    t.bytesEmitted += info.bytesEmitted;
  };

  return {
    onContain,
    report: () => ({
      calls,
      bytesContained,
      bytesEmitted,
      reductionFactor: bytesEmitted > 0 ? bytesContained / bytesEmitted : Infinity,
      byTool: structuredClone(byTool),
    }),
    format: () => {
      const factor = bytesEmitted > 0 ? `${(bytesContained / bytesEmitted).toFixed(1)}× less` : "n/a";
      return `${calls} call(s) · ${humanBytes(bytesContained)} contained → ${humanBytes(bytesEmitted)} emitted (${factor})`;
    },
    reset: () => {
      calls = 0;
      bytesContained = 0;
      bytesEmitted = 0;
      for (const k of Object.keys(byTool)) delete byTool[k];
    },
  };
}
