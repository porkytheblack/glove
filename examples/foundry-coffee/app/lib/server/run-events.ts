import type { FoundryEvent } from "glove-foundry";
import type { TurnEvent } from "../turn-events";
import { FOUNDRY_URL, foundry } from "./foundry";

// A Foundry run, as the page needs to see it. Foundry's event stream carries
// everything a run does (model requests with the system prompt, logs,
// commands); only the events below are passed on, each cut down to the
// fields listed in TurnEvent.

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The part of a Foundry event the page needs, or null to drop it. */
export function reduce(event: Pick<FoundryEvent, "type" | "data">): TurnEvent | null {
  const data = record(event.data);
  switch (event.type) {
    case "agent.text_delta":
      return text(data.text) ? { type: "text", text: text(data.text) } : null;
    case "agent.model_response_complete":
      return { type: "response_end" };
    case "agent.tool_use":
      return { type: "tool", id: text(data.id), name: text(data.name), input: data.input };
    case "agent.tool_use_result": {
      const result = record(data.result);
      return {
        type: "tool_result",
        id: text(data.call_id) || text(data.id),
        name: text(data.tool_name) || text(data.name),
        ok: result.status === "success",
        ...(text(result.message) ? { message: text(result.message) } : {}),
      };
    }
    case "agent.foundry.approval.requested":
      return { type: "approval", id: text(data.id), toolName: text(data.toolName), input: data.toolInput };
    case "approval.resolved":
      return { type: "approval_resolved", id: text(data.approvalId), status: text(data.status) };
    // Emitted by the barista's name_speaker tool (agents/barista/tools.ts).
    case "agent.coffee.speaker_named":
      return { type: "speaker_named", speaker: text(data.speaker), name: text(data.name) };
    case "run.completed":
      return { type: "end", status: "completed" };
    case "run.cancelled":
    case "run.skipped":
      return { type: "end", status: "cancelled" };
    case "run.failed":
    case "run.timeout":
      return { type: "end", status: "failed", error: text(data.error) || text(data.message) || "The run failed." };
    default:
      return null;
  }
}

/** `data:` payloads of a server-sent event stream. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
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
 * Follow one run from its first event to its last. Always ends with an
 * `end` event. Aborting `signal` stops following; it does not cancel the run.
 */
export async function* followRun(runId: string, signal?: AbortSignal): AsyncGenerator<TurnEvent> {
  // `after=0` replays what the run did before this request was open.
  const query = new URLSearchParams({ runId, after: "0" });
  const response = await fetch(`${FOUNDRY_URL}/api/events?${query}`, {
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Foundry events: ${response.status}`);
  for await (const event of sse(response.body)) {
    const reduced = reduce(event as FoundryEvent);
    if (!reduced) continue;
    yield reduced;
    if (reduced.type === "end") return;
  }
  // The stream closed without a terminal event: report how the run stands.
  const run = await foundry().getRun(runId);
  yield {
    type: "end",
    status: run.status === "completed" ? "completed" : run.status === "cancelled" ? "cancelled" : "failed",
    ...(run.error ? { error: run.error } : {}),
  };
}
