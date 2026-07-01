/**
 * A `SubscriberAdapter` that turns the agent's event stream into (a) a compact
 * metrics summary and (b) a full JSONL transcript. It is model-agnostic: tool
 * invocations are counted from `tool_use_result` (emitted by the Executor for
 * every executed call, streaming or not), turns from the per-call model response,
 * tokens + peak context from `token_consumption`, and compactions from
 * `compaction_start`.
 */
import type { SubscriberAdapter, SubscriberEvent, SubscriberEventDataMap, ToolCall } from "glove-core";

export interface RunMetrics {
  turns: number;
  toolCalls: number;
  toolErrors: number;
  toolCallsByName: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  /** Largest single-call prompt size = peak context-window occupancy. */
  peakContextTokens: number;
  compactions: number;
}

export interface TranscriptEntry {
  t: number;
  type: string;
  [k: string]: unknown;
}

function preview(v: unknown, max = 240): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s == null) return "";
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s;
}

export class BenchSubscriber implements SubscriberAdapter {
  readonly metrics: RunMetrics = {
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolCallsByName: {},
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    peakContextTokens: 0,
    compactions: 0,
  };
  readonly transcript: TranscriptEntry[] = [];
  private readonly start = Date.now();
  private readonly echo: boolean;

  constructor(opts: { echo?: boolean } = {}) {
    this.echo = opts.echo ?? false;
  }

  private log(type: string, extra: Record<string, unknown>) {
    this.transcript.push({ t: Date.now() - this.start, type, ...extra });
    if (this.echo) console.log(`    · ${type} ${preview(extra, 160)}`);
  }

  async record<T extends SubscriberEvent["type"]>(type: T, data: SubscriberEventDataMap[T]): Promise<void> {
    switch (type) {
      case "model_response":
      case "model_response_complete": {
        const d = data as SubscriberEventDataMap["model_response"];
        this.metrics.turns++;
        const calls = (d.tool_calls ?? []) as ToolCall[];
        this.log(type, {
          turn: this.metrics.turns,
          stop_reason: d.stop_reason,
          text: preview(d.text ?? ""),
          tool_calls: calls.map((c) => ({ name: c.tool_name, input: preview(c.input_args, 400) })),
        });
        break;
      }
      case "tool_use_result": {
        const d = data as SubscriberEventDataMap["tool_use_result"];
        this.metrics.toolCalls++;
        this.metrics.toolCallsByName[d.tool_name] = (this.metrics.toolCallsByName[d.tool_name] ?? 0) + 1;
        if (d.result?.status === "error") this.metrics.toolErrors++;
        this.log("tool_result", {
          tool: d.tool_name,
          status: d.result?.status,
          data: preview(d.result?.data, 300),
          ...(d.result?.status === "error" && { message: d.result?.message }),
        });
        break;
      }
      case "token_consumption": {
        const d = data as SubscriberEventDataMap["token_consumption"];
        const c = d.consumption;
        this.metrics.tokensIn += c.tokens_in ?? 0;
        this.metrics.tokensOut += c.tokens_out ?? 0;
        this.metrics.cacheRead += c.cache_read_input_tokens ?? 0;
        this.metrics.peakContextTokens = Math.max(this.metrics.peakContextTokens, c.tokens_in ?? 0);
        this.log("tokens", { in: c.tokens_in, out: c.tokens_out, peak: this.metrics.peakContextTokens });
        break;
      }
      case "compaction_start": {
        const d = data as SubscriberEventDataMap["compaction_start"];
        this.metrics.compactions++;
        this.log("compaction_start", { at_tokens: d.current_token_consumption });
        break;
      }
      case "compaction_end": {
        const d = data as SubscriberEventDataMap["compaction_end"];
        this.log("compaction_end", { at_tokens: d.current_token_consumption });
        break;
      }
      default:
        break;
    }
  }
}
