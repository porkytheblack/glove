import crypto from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import type { MonitorStorageAdapter } from "../../../adapters/types.js"
import { generateApiKey, generateRegistrationToken } from "../../auth/tokens.js"
import { requireSession } from "../../middleware/auth.js"

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
})

const CreateRegTokenSchema = z.object({
  name: z.string().min(1).max(120),
  expiresAt: z.string().datetime().nullish(),
})

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(["read", "admin"])).min(1).default(["read"]),
})

const SetPricingSchema = z.object({
  model: z.string().min(1).max(120),
  inputPer1kMicros: z.number().int().min(0),
  outputPer1kMicros: z.number().int().min(0),
})

export function projectsRoutes(adapter: MonitorStorageAdapter): Hono {
  const app = new Hono()

  app.use("/*", requireSession())

  app.get("/", async (c) => {
    const list = await adapter.listProjects()
    return c.json({ data: list })
  })

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = CreateProjectSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400)
    const existing = await adapter.getProjectBySlug(parsed.data.slug)
    if (existing) return c.json({ error: "slug_taken" }, 409)
    const project = {
      id: `prj_${crypto.randomBytes(8).toString("hex")}`,
      slug: parsed.data.slug,
      name: parsed.data.name,
      createdAt: new Date().toISOString(),
    }
    await adapter.insertProject(project)
    return c.json({ data: project }, 201)
  })

  app.get("/:id", async (c) => {
    const project = await adapter.getProject(c.req.param("id"))
    if (!project) return c.json({ error: "not_found" }, 404)
    return c.json({ data: project })
  })

  // ── Registration tokens ──
  app.get("/:id/registration-tokens", async (c) => {
    const list = await adapter.listRegistrationTokens(c.req.param("id"))
    return c.json({ data: list.map(({ tokenHash: _h, ...rest }) => rest) })
  })

  app.post("/:id/registration-tokens", async (c) => {
    const projectId = c.req.param("id")
    const project = await adapter.getProject(projectId)
    if (!project) return c.json({ error: "not_found" }, 404)
    const body = await c.req.json().catch(() => ({}))
    const parsed = CreateRegTokenSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400)
    const t = generateRegistrationToken(project.slug)
    const record = {
      id: `rgt_${crypto.randomBytes(8).toString("hex")}`,
      projectId,
      name: parsed.data.name,
      tokenHash: t.hash,
      tokenPrefix: t.prefix,
      scopes: ["ingest"],
      createdAt: new Date().toISOString(),
      expiresAt: parsed.data.expiresAt ?? null,
      revoked: false,
    }
    await adapter.insertRegistrationToken(record)
    const { tokenHash: _h, ...publicRecord } = record
    return c.json({ data: { ...publicRecord, token: t.raw } }, 201)
  })

  app.delete("/:id/registration-tokens/:tokenId", async (c) => {
    const ok = await adapter.revokeRegistrationToken(c.req.param("tokenId"))
    return c.json({ ok })
  })

  // ── API keys ──
  app.get("/:id/keys", async (c) => {
    const list = await adapter.listApiKeys(c.req.param("id"))
    return c.json({ data: list })
  })

  app.post("/:id/keys", async (c) => {
    const projectId = c.req.param("id")
    const project = await adapter.getProject(projectId)
    if (!project) return c.json({ error: "not_found" }, 404)
    const body = await c.req.json().catch(() => ({}))
    const parsed = CreateApiKeySchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400)
    const k = generateApiKey()
    const record = {
      id: `key_${crypto.randomBytes(8).toString("hex")}`,
      projectId,
      name: parsed.data.name,
      keyHash: k.hash,
      keyPrefix: k.prefix,
      scopes: parsed.data.scopes,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      expiresAt: null,
      revoked: false,
    }
    await adapter.insertApiKey(record)
    const { keyHash: _h, ...rest } = record
    return c.json({ data: { ...rest, key: k.raw } }, 201)
  })

  app.delete("/:id/keys/:keyId", async (c) => {
    const ok = await adapter.revokeApiKey(c.req.param("keyId"))
    return c.json({ ok })
  })

  // ── Pricing rates ──
  app.get("/:id/pricing", async (c) => {
    const list = await adapter.listPricingRates()
    return c.json({ data: list })
  })

  app.put("/:id/pricing", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = SetPricingSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400)
    await adapter.upsertPricingRate({
      model: parsed.data.model,
      inputPer1kMicros: parsed.data.inputPer1kMicros,
      outputPer1kMicros: parsed.data.outputPer1kMicros,
      updatedAt: new Date().toISOString(),
    })
    return c.json({ ok: true })
  })

  return app
}
