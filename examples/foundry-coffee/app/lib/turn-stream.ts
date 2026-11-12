import type { TurnEvent, TurnRequest } from "./turn-events";

/**
 * Send one turn and follow its run. `onEvent` is awaited for each event, in
 * order. Aborting `signal` closes the request, which cancels the run.
 * Rejects when the turn could not be sent or the run failed.
 */
export async function streamTurn(
  body: TurnRequest,
  onEvent: (event: TurnEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const failure = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(failure.error ?? `The turn could not be sent (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  while (!ended) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const event = JSON.parse(data) as TurnEvent;
      await onEvent(event);
      if (event.type === "end") {
        ended = true;
        if (event.status === "failed") throw new Error(event.error ?? "The run failed.");
      }
    }
  }
  if (!ended && signal?.aborted) throw new DOMException("The turn was interrupted.", "AbortError");
}
