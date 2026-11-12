import { SHOP, type TurnPayload } from "../../../lib/shop";
import { foundry, unavailable } from "../../lib/server/foundry";
import { followRun } from "../../lib/server/run-events";
import type { TurnEvent, TurnRequest } from "../../lib/turn-events";

export const dynamic = "force-dynamic";

// One customer turn. The message goes to the barista's conversation in
// Foundry; the reply comes back as server-sent events while the run works.
// Closing the request (a barge-in, or Stop) cancels the run.

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as Partial<TurnRequest>;
  const message = body.text?.trim();
  if (!body.conversationId || !message) {
    return Response.json({ error: "conversationId and text are required." }, { status: 400 });
  }

  let runId: string;
  try {
    // Who is speaking rides in the payload, not in the conversation.
    const payload: TurnPayload | undefined = body.voice ? { voice: body.voice } : undefined;
    const handle = await foundry().send(SHOP.agentId, body.conversationId, message, payload ? { payload } : {});
    runId = handle.id;
  } catch (error) {
    return unavailable(error);
  }

  const encoder = new TextEncoder();
  const upstream = new AbortController();
  let ended = false;

  /** The customer stopped listening: stop following, and stop the run. */
  const abandon = () => {
    if (ended) return;
    ended = true;
    upstream.abort();
    void foundry().cancelRun(runId).catch(() => undefined);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TurnEvent) => {
        if (ended) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (event.type === "end") {
          ended = true;
          controller.close();
        }
      };
      request.signal.addEventListener(
        "abort",
        () => {
          const open = !ended;
          abandon();
          if (open) try { controller.close(); } catch { /* already closed */ }
        },
        { once: true },
      );

      send({ type: "run", runId });
      try {
        for await (const event of followRun(runId, upstream.signal)) send(event);
      } catch (error) {
        send({ type: "end", status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    },
    cancel: abandon,
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
