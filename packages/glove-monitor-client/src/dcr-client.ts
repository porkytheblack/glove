import type { CachedCredentials, CredentialStorage } from "./storage.js"

export interface DcrClientOptions {
  url: string                                // base URL of glove-monitor
  registrationToken?: string
  clientName?: string
  softwareId?: string
  storage: CredentialStorage
  storageKey: string                         // typically `${url}|${registrationToken}`
  fetch?: typeof globalThis.fetch
}

export class DcrError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message)
    this.name = "DcrError"
  }
}

/**
 * Lazily resolves credentials needed to call /api/v1/ingest.
 *
 * Flow:
 *   1. ensureCredentials() returns a cached client_id/secret if available.
 *   2. Otherwise registers via /oauth/register using the registration token.
 *   3. getAccessToken() trades the cached client_id/secret for a short-lived
 *      bearer access token via /oauth/token (cached in-process).
 *
 * On 401 from a downstream call, callers should:
 *   - first invalidate the cached access token (refreshAccessToken)
 *   - if that still fails, reset() and let ensureCredentials re-register
 */
export class DcrClient {
  private readonly url: string
  private readonly fetchFn: typeof globalThis.fetch
  private readonly opts: DcrClientOptions
  private cachedCreds: CachedCredentials | null = null
  private cachedAccessToken: { token: string; expiresAt: number } | null = null
  private inFlight: Promise<CachedCredentials> | null = null

  constructor(opts: DcrClientOptions) {
    this.opts = opts
    this.url = opts.url.replace(/\/+$/, "")
    this.fetchFn = opts.fetch ?? globalThis.fetch
  }

  async ensureCredentials(): Promise<CachedCredentials> {
    if (this.cachedCreds) return this.cachedCreds
    if (this.inFlight) return this.inFlight
    this.inFlight = (async () => {
      const cached = await this.opts.storage.load(this.opts.storageKey)
      if (cached) {
        this.cachedCreds = cached
        return cached
      }
      if (!this.opts.registrationToken) {
        throw new DcrError(
          "No cached credentials and no registration token provided. " +
            "Set GLOVE_MONITOR_REG_TOKEN or pass `registrationToken`.",
        )
      }
      const fresh = await this.register()
      this.cachedCreds = fresh
      await this.opts.storage.save(this.opts.storageKey, fresh)
      return fresh
    })().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async register(): Promise<CachedCredentials> {
    const res = await this.fetchFn(`${this.url}/oauth/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.opts.registrationToken!}`,
      },
      body: JSON.stringify({
        client_name: this.opts.clientName,
        software_id: this.opts.softwareId,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new DcrError(`registration failed: ${res.status} ${text}`, res.status)
    }
    const body = await res.json() as {
      client_id: string
      client_secret: string
      registration_access_token: string
    }
    return {
      clientId: body.client_id,
      clientSecret: body.client_secret,
      registrationAccessToken: body.registration_access_token,
      registeredAt: new Date().toISOString(),
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now() + 30_000) {
      return this.cachedAccessToken.token
    }
    const creds = await this.ensureCredentials()
    const res = await this.fetchFn(`${this.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }).toString(),
    })
    if (!res.ok) {
      if (res.status === 401) {
        // Credentials no longer valid (revoked / new server secret) — drop cache.
        await this.reset()
      }
      const text = await res.text().catch(() => "")
      throw new DcrError(`token failed: ${res.status} ${text}`, res.status)
    }
    const body = await res.json() as { access_token: string; expires_in: number }
    this.cachedAccessToken = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in * 1000),
    }
    return body.access_token
  }

  async reset(): Promise<void> {
    this.cachedCreds = null
    this.cachedAccessToken = null
    await this.opts.storage.clear(this.opts.storageKey)
  }
}
