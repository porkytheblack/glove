import { Hono } from "hono"
import { requireScope } from "../../middleware/auth.js"
import type { SSEHub } from "../../sse.js"

export function eventsRoutes(sseHub: SSEHub): Hono {
  const app = new Hono()

  app.get("/", requireScope("read"), (c) => {
    const auth = c.get("auth")
    const projectId = auth.projectId ?? null

    const stream = new ReadableStream({
      start: (controller) => {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(": connected\n\n"))
        const unsubscribe = sseHub.add({ projectId, controller })
        const heartbeat = setInterval(() => {
          try { controller.enqueue(enc.encode(": ping\n\n")) }
          catch { clearInterval(heartbeat); unsubscribe() }
        }, 30_000)
        // Disconnect handling: ReadableStream's pull/cancel hooks would clean
        // up here. Hono's runtime closes the controller on client disconnect.
        ;(c.req.raw as { signal?: AbortSignal }).signal?.addEventListener("abort", () => {
          clearInterval(heartbeat)
          unsubscribe()
          try { controller.close() } catch {}
        })
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      },
    })
  })

  return app
}
