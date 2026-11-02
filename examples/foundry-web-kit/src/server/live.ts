import type { FoundryEvent } from "glove-foundry";
import { TERMINAL_RUN_EVENTS, type LiveEvent } from "../shared";
import { foundry, foundryConnection, type Foundry } from "./foundry";
import { toolLabel, type ToolLabel } from "./messages";

// A run's live updates, passed on to the page. The server follows Foundry's
// event stream for one run and re-emits only the events below, each cut down
// to the fields listed. Everything else (model requests with their system
// prompt, tool input and results, logs, commands) stays on the server.

export interface LiveOptions {
  /** A label for a tool call, from its name and input. Only the label is sent. */
  readonly describeTool?: (name: string, input: unknown) => ToolLabel;
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** The whitelisted, reduced form of one Foundry event, or null to drop it. */
export function reduceEvent(event: Pick<FoundryEvent, "sequence" | "type" | "data">, options: LiveOptions = {}): LiveEvent | null {
  const data = record(event.data);
  const seq = event.sequence;
  switch (event.type) {
    case "agent.text_delta":
      return text(data.text) ? { seq, type: "agent.text_delta", text: text(data.text) } : null;
    case "agent.tool_use": {
      const name = text(data.name);
      return name ? { seq, type: "agent.tool_use", name, ...toolLabel(options.describeTool?.(name, data.input)) } : null;
    }
    case "agent.tool_use_result": {
      const name = text(data.name) || text(data.tool_name);
      return name ? { seq, type: "agent.tool_use_result", name, status: record(data.result).status === "success" ? "done" : "error" } : null;
    }
    case "agent.foundry.approval.requested":
      return text(data.id) ? { seq, type: "agent.foundry.approval.requested", approvalId: text(data.id), toolName: text(data.toolName) } : null;
    case "approval.resolved":
      return { seq, type: "approval.resolved", approvalId: text(data.approvalId), status: text(data.status) };
    case "run.started":
    case "run.completed":
    case "run.failed":
    case "run.cancelled":
      return { seq, type: event.type };
    // A timeout is a failure, and a skipped run never ran, as far as the page is concerned.
    case "run.timeout":
      return { seq, type: "run.failed" };
    case "run.skipped":
      return { seq, type: "run.cancelled" };
    default:
      return null;
  }
}

const encoder = new TextEncoder();
const frame = (event: LiveEvent) => encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);

/** Reads `data:` payloads out of a server-sent event stream. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Not an event.
      }
    }
  }
}

/**
 * A server-sent event Response with the run's live updates after `after`
 * (an event sequence; EventSource sends it back as Last-Event-ID). The stream
 * ends with the run. Check the run belongs to the person first (ownedRun).
 */
export async function liveRun(
  runId: string,
  options: LiveOptions & {
    readonly after?: number;
    readonly signal?: AbortSignal;
    readonly client?: Pick<Foundry, "getRun" | "getEvents">;
    readonly fetch?: typeof globalThis.fetch;
    readonly heartbeatMs?: number;
  } = {},
): Promise<Response> {
  const client = options.client ?? foundry();
  const after = options.after ?? 0;
  const upstream = new AbortController();
  options.signal?.addEventListener("abort", () => upstream.abort(), { once: true });
  const run = await client.getRun(runId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        upstream.abort();
        try { controller.close(); } catch { /* already closed */ }
      };
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(": ping\n\n")); }, options.heartbeatMs ?? 15_000);
      const emit = (event: unknown): void => {
        const reduced = reduceEvent(event as FoundryEvent, options);
        if (!reduced || closed) return;
        controller.enqueue(frame(reduced));
        if (TERMINAL_RUN_EVENTS.includes(reduced.type)) close();
      };
      upstream.signal.addEventListener("abort", close, { once: true });
      try {
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          // Already over: replay what is left in memory (a terminal event closes the
          // stream), then say how it ended if that event is no longer kept.
          for (const event of await client.getEvents({ runId, after })) emit(event);
          if (!closed) controller.enqueue(frame({ seq: after, type: `run.${run.status}` as "run.completed" }));
          return close();
        }
        const { baseUrl, headers } = foundryConnection();
        const query = new URLSearchParams({ runId, after: String(after) });
        const response = await (options.fetch ?? fetch)(`${baseUrl}/api/events?${query}`, {
          headers: { ...headers, accept: "text/event-stream" },
          signal: upstream.signal,
        });
        if (!response.ok || !response.body) return close();
        for await (const event of sse(response.body)) {
          emit(event);
          if (closed) break;
        }
      } catch (error) {
        if (!upstream.signal.aborted) console.error(error);
      }
      close();
    },
    cancel() {
      upstream.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/** Where to resume: `?after=` or the Last-Event-ID EventSource sends on reconnect. */
export function resumeAfter(request: Request): number {
  const value = new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id");
  const after = Number(value);
  return Number.isFinite(after) && after > 0 ? after : 0;
}
