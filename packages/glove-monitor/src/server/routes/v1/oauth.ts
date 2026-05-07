import crypto from "node:crypto"
import { Hono } from "hono"
import { z } from "zod"
import type { MonitorStorageAdapter } from "../../../adapters/types.js"
import {
  generateClientCredentials,
  sha256Hex,
  signAccessToken,
} from "../../auth/tokens.js"

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")) }
  catch { return false }
}

export interface OauthRouterOptions {
  adapter: MonitorStorageAdapter
  accessTokenSecret: string
  accessTokenTtlMs: number
}

const RegisterBodySchema = z.object({
  client_name: z.string().min(1).max(120).optional(),
  software_id: z.string().min(1).max(200).optional(),
})

const TokenBodySchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
})

export function oauthRoutes(opts: OauthRouterOptions): Hono {
  const app = new Hono()

  // RFC 7591 §3 — Dynamic Client Registration. Token-gated: caller must present
  // a valid registration token in the Authorization header.
  app.post("/register", async (c) => {
    const authHeader = c.req.header("authorization") ?? c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "invalid_token", error_description: "registration token required" }, 401)
    }
    const rawToken = authHeader.slice("Bearer ".length).trim()
    const tokenHash = sha256Hex(rawToken)
    const tokenRecord = await opts.adapter.findRegistrationTokenByHash(tokenHash)
    if (!tokenRecord || tokenRecord.revoked) {
      return c.json({ error: "invalid_token" }, 401)
    }
    if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) < new Date()) {
      return c.json({ error: "invalid_token", error_description: "expired" }, 401)
    }

    const body = await c.req.json().catch(() => ({}))
    const parsed = RegisterBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid_client_metadata", details: parsed.error.flatten() }, 400)
    }

    const creds = generateClientCredentials()
    await opts.adapter.insertClient({
      id: creds.clientId,
      projectId: tokenRecord.projectId,
      name: parsed.data.client_name ?? null,
      softwareId: parsed.data.software_id ?? null,
      clientSecretHash: creds.clientSecretHash,
      registrationAccessTokenHash: creds.registrationAccessTokenHash,
      createdAt: new Date().toISOString(),
      lastSeen: null,
      revoked: false,
    })

    return c.json({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      registration_access_token: creds.registrationAccessToken,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["client_credentials"],
    }, 201)
  })

  // OAuth 2.0 token endpoint — client_credentials grant only.
  app.post("/token", async (c) => {
    const contentType = c.req.header("content-type") ?? ""
    let body: Record<string, unknown> = {}
    if (contentType.includes("application/json")) {
      body = await c.req.json().catch(() => ({}))
    } else {
      // application/x-www-form-urlencoded
      const text = await c.req.text()
      const params = new URLSearchParams(text)
      for (const [k, v] of params.entries()) body[k] = v
    }
    const parsed = TokenBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400)
    }
    const { client_id, client_secret } = parsed.data
    const client = await opts.adapter.getClient(client_id)
    if (!client || client.revoked) return c.json({ error: "invalid_client" }, 401)
    if (!timingSafeHexEqual(sha256Hex(client_secret), client.clientSecretHash)) {
      return c.json({ error: "invalid_client" }, 401)
    }

    const exp = Date.now() + opts.accessTokenTtlMs
    const accessToken = signAccessToken(
      { client_id: client.id, project_id: client.projectId, exp },
      opts.accessTokenSecret,
    )
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(opts.accessTokenTtlMs / 1000),
    })
  })

  return app
}
