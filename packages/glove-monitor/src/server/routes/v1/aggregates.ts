import { Hono } from "hono"
import type { MonitorStorageAdapter } from "../../../adapters/types.js"
import { requireScope } from "../../middleware/auth.js"

/**
 * Aggregate read endpoints: tools, models, apps, clients.
 * Computed live from the storage adapter — for production scale the SQLite
 * adapter should be swapped for an OLAP-friendly backend, but the schema
 * already carries the indexes needed for these aggregates to be fast.
 */
export function aggregateRoutes(adapter: MonitorStorageAdapter): Hono {
  const app = new Hono()
  app.use("/*", requireScope("read"))

  app.get("/tools", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const stats = await adapter.listToolCallStats(auth.projectId)
    return c.json({ data: stats })
  })

  app.get("/apps", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const apps = await adapter.listApps(auth.projectId)
    return c.json({ data: apps })
  })

  app.get("/clients", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const clients = await adapter.listClients(auth.projectId)
    return c.json({
      data: clients.map((cl) => ({
        id: cl.id,
        projectId: cl.projectId,
        name: cl.name,
        softwareId: cl.softwareId,
        createdAt: cl.createdAt,
        lastSeen: cl.lastSeen,
        revoked: cl.revoked,
      })),
    })
  })

  app.delete("/clients/:id", async (c) => {
    const ok = await adapter.revokeClient(c.req.param("id"))
    return c.json({ ok })
  })

  // Models breakdown — computed by walking conversations' models_used.
  // Sufficient for v1; can be swapped for a materialised view later.
  app.get("/models", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const { conversations } = await adapter.listConversations({ projectId: auth.projectId, limit: 1000 })
    const byModel = new Map<string, { conversations: number; tokensIn: number; tokensOut: number; costMicros: number }>()
    for (const conv of conversations) {
      for (const m of conv.modelsUsed) {
        const slot = byModel.get(m) ?? { conversations: 0, tokensIn: 0, tokensOut: 0, costMicros: 0 }
        slot.conversations++
        slot.tokensIn += conv.totalTokensIn
        slot.tokensOut += conv.totalTokensOut
        slot.costMicros += conv.totalCostMicros
        byModel.set(m, slot)
      }
    }
    return c.json({
      data: Array.from(byModel.entries()).map(([model, s]) => ({ model, ...s })),
    })
  })

  return app
}
