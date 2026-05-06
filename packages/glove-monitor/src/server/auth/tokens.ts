import crypto from "node:crypto"

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex")
}

export function generateRegistrationToken(projectSlug: string): { raw: string; hash: string; prefix: string } {
  const raw = `gmrt_${projectSlug}_${randomHex(16)}`
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 16) }
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk_live_${randomHex(16)}`
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, 12) }
}

export function generateClientCredentials(): {
  clientId: string
  clientSecret: string
  clientSecretHash: string
  registrationAccessToken: string
  registrationAccessTokenHash: string
} {
  const clientId = `gmc_${randomHex(12)}`
  const clientSecret = randomHex(32)
  const registrationAccessToken = `gmrat_${randomHex(24)}`
  return {
    clientId,
    clientSecret,
    clientSecretHash: sha256Hex(clientSecret),
    registrationAccessToken,
    registrationAccessTokenHash: sha256Hex(registrationAccessToken),
  }
}

// ─── Client-credentials access tokens ────────────────────────────────
//
// Short-lived bearer tokens minted by /oauth/token. Self-contained signed
// tokens — no DB lookup needed for verification, just HMAC + claim check.
//
// Claims:
//   iss — issuer; constant "glove-monitor"
//   aud — audience; the token's intended project_id (binds tokens to a project)
//   sub — subject; the client_id (DCR'd glove instance)
//   jti — unique token id (random); enables future per-token revocation
//   iat — issued-at, unix ms
//   exp — expiry, unix ms (with 30s clock-skew tolerance on verify)

export const ACCESS_TOKEN_ISSUER = "glove-monitor"

export interface AccessTokenPayload {
  iss: string
  aud: string  // project_id
  sub: string  // client_id
  jti: string
  iat: number
  exp: number  // unix ms
}

/** Backwards-compatible accessor — surface the underlying client_id / project_id. */
export interface AccessTokenIdentity {
  client_id: string
  project_id: string
  jti: string
  exp: number
}

export function payloadIdentity(p: AccessTokenPayload): AccessTokenIdentity {
  return { client_id: p.sub, project_id: p.aud, jti: p.jti, exp: p.exp }
}

export interface AccessTokenInput {
  client_id: string
  project_id: string
  exp: number  // unix ms
}

export function signAccessToken(input: AccessTokenInput, secret: string): string {
  const payload: AccessTokenPayload = {
    iss: ACCESS_TOKEN_ISSUER,
    aud: input.project_id,
    sub: input.client_id,
    jti: crypto.randomBytes(8).toString("hex"),
    iat: Date.now(),
    exp: input.exp,
  }
  const body = JSON.stringify(payload)
  const bodyB64 = Buffer.from(body, "utf8").toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(bodyB64).digest("base64url")
  return `${bodyB64}.${sig}`
}

const CLOCK_SKEW_MS = 30_000

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload | null {
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const bodyB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac("sha256", secret).update(bodyB64).digest("base64url")
  if (!timingSafeEqualString(sig, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as Partial<AccessTokenPayload>
    if (payload.iss !== ACCESS_TOKEN_ISSUER) return null
    if (typeof payload.aud !== "string" || typeof payload.sub !== "string") return null
    if (typeof payload.jti !== "string" || typeof payload.iat !== "number") return null
    if (typeof payload.exp !== "number" || payload.exp < Date.now() - CLOCK_SKEW_MS) return null
    return payload as AccessTokenPayload
  } catch {
    return null
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}
