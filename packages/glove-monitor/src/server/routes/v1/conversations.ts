import { Hono } from "hono"
import type { MonitorStorageAdapter } from "../../../adapters/types.js"
import { requireScope } from "../../middleware/auth.js"

export function conversationsRoutes(adapter: MonitorStorageAdapter): Hono {
  const app = new Hono()
  app.use("/*", requireScope("read"))

  app.get("/", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const url = new URL(c.req.url)
    const list = await adapter.listConversations({
      projectId: auth.projectId,
      appName: url.searchParams.get("app") ?? undefined,
      subject: url.searchParams.get("subject") ?? undefined,
      status: (url.searchParams.get("status") as "active" | "completed" | "errored" | null) ?? undefined,
      limit: url.searchParams.get("limit") ? Math.min(Number(url.searchParams.get("limit")), 200) : 50,
    })
    return c.json({ data: list })
  })

  app.get("/:id", async (c) => {
    const conv = await adapter.getConversation(c.req.param("id"))
    if (!conv) return c.json({ error: "not_found" }, 404)
    return c.json({ data: conv })
  })

  app.get("/:id/events", async (c) => {
    const url = new URL(c.req.url)
    const limit = url.searchParams.get("limit") ? Math.min(Number(url.searchParams.get("limit")), 5000) : 1000
    const events = await adapter.listEventsForConversation(c.req.param("id"), limit)
    return c.json({ data: events })
  })

  return app
}
