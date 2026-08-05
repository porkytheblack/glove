/**
 * The agent turn, streamed.
 *
 * The agent runs here, not in the browser, so this route is not a model proxy
 * (`glove-next`'s `createChatHandler` is that, and it is the right thing when
 * tools are client-side). It runs `processRequest` and forwards the agent's
 * own event stream to the browser as SSE.
 */
import { getDesk, reapOldDesks, type DeskEvent } from "@/lib/desk";

// Worker threads and native libraries: this cannot run on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A long extraction plus a render can legitimately outlast the default.
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const { sessionId, message } = (await req.json()) as { sessionId?: string; message?: string };
  if (!sessionId || typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "sessionId and a non-empty message are required" }, { status: 400 });
  }

  const desk = await getDesk(sessionId);
  await reapOldDesks();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: DeskEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // client hung up mid-turn
        }
      };

      desk.listeners.add(send);
      try {
        await desk.agent.processRequest(message);
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        desk.listeners.delete(send);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer SSE into uselessness without this.
      "X-Accel-Buffering": "no",
    },
  });
}
