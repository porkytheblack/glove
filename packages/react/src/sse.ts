import type { RemoteStreamEvent } from "./adapters/remote-model";

/**
 * Parse a Server-Sent Events response into an async iterable of RemoteStreamEvents.
 *
 * Handles chunked delivery, `\n\n` segment splitting, `data: ` prefix parsing,
 * and final buffer flush on stream end.
 */
export async function* parseSSEStream(
  response: Response,
): AsyncIterable<RemoteStreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const segments = buffer.split("\n\n");
    buffer = segments.pop()!;

    for (const segment of segments) {
      const line = segment.trim();
      if (line.startsWith("data: ")) {
        yield JSON.parse(line.slice(6));
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim().startsWith("data: ")) {
    yield JSON.parse(buffer.trim().slice(6));
  }
}
