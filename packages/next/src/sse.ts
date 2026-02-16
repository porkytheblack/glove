/**
 * Create a ReadableStream that encodes events as Server-Sent Events.
 *
 * The handler function receives a `send` callback to emit events.
 * Each event is encoded as `data: <JSON>\n\n`.
 * Errors are caught and sent as a `done` event with the error message.
 */
export function createSSEStream(
  handler: (send: (event: unknown) => void) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        await handler(send);
      } catch (err: any) {
        send({
          type: "done",
          message: {
            sender: "agent",
            text: `Error: ${err?.message ?? "Unknown error"}`,
          },
          tokens_in: 0,
          tokens_out: 0,
        });
      }

      controller.close();
    },
  });
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
