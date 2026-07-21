import { getSession } from "@/lib/server/session";
import type { SessionEvent } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE channel for one session. All pipeline events stream through here. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return new Response("unknown session", { status: 404 });

  const encoder = new TextEncoder();
  let unsub: () => void = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: SessionEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* controller closed */
        }
      };

      // Initial snapshot so a fresh connection is oriented.
      const buildError = session.getBuildError();
      if (buildError) send({ type: "error", message: buildError });
      send({ type: "stats", stats: session.snapshotStats() });
      send({ type: "phase", phase: "idle" });

      unsub = session.subscribe(send);

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* controller closed */
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        unsub();
        if (keepalive) clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsub();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
