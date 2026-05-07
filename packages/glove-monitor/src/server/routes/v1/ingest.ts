import { Hono } from "hono"
import { IngestPayloadSchema } from "../../../shared/event-schema.js"
import { ingestPayload, type IngestContext } from "../../ingest-pipeline.js"
import { requireIngest } from "../../middleware/auth.js"

export function ingestRoutes(ctx: IngestContext): Hono {
  const app = new Hono()

  app.post("/", requireIngest(), async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId || !auth.clientId) return c.json({ error: "unauthorized" }, 401)

    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: "invalid_request", error_description: "missing body" }, 400)
    const parsed = IngestPayloadSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400)
    }

    const result = await ingestPayload(
      ctx,
      { projectId: auth.projectId, clientId: auth.clientId },
      parsed.data,
    )
    return c.json({ ok: true, accepted: result.accepted })
  })

  return app
}
