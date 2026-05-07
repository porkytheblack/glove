import crypto from "node:crypto"

export interface SessionConfig {
  username: string
  /** SHA-256 hex digest of the admin password (used for verification only). */
  passwordHash: string
  /**
   * HMAC secret used to sign session cookies. Independent from the password
   * so that rotating either does not silently invalidate the other.
   */
  sessionSecret: string
  ttlMs: number
}

export const SESSION_COOKIE_NAME = "glove_monitor_session"

/**
 * Forbid `:` in usernames so the colon-delimited payload can be parsed
 * unambiguously without HMAC-confusion concerns.
 */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex")
}

export function buildSessionConfig(input: {
  username: string
  password: string
  sessionSecret?: string
  ttlMs: number
}): SessionConfig {
  if (!USERNAME_PATTERN.test(input.username)) {
    throw new Error(`Invalid admin username "${input.username}" — must match ${USERNAME_PATTERN}`)
  }
  return {
    username: input.username,
    passwordHash: hashPassword(input.password),
    sessionSecret: input.sessionSecret ?? crypto.randomBytes(32).toString("hex"),
    ttlMs: input.ttlMs,
  }
}

export function verifyCredentials(config: SessionConfig, username: string, password: string): boolean {
  if (!USERNAME_PATTERN.test(username)) return false
  // Pad both sides to a fixed length before comparing the username so the
  // timing of `===` doesn't reveal length. (Then a constant-time compare on
  // the hash is what actually authenticates.)
  if (!constantTimeStringEqual(username, config.username)) return false
  const candidate = hashPassword(password)
  return constantTimeStringEqual(candidate, config.passwordHash)
}

export function createSessionToken(config: SessionConfig): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + config.ttlMs
  const payload = `${config.username}:${expiresAt}`
  const sig = signHmac(payload, config.sessionSecret)
  return { token: base64url(`${payload}:${sig}`), expiresAt }
}

export function verifySessionToken(config: SessionConfig, token: string): { username: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8")
    const lastColon = decoded.lastIndexOf(":")
    if (lastColon < 0) return null
    const payload = decoded.slice(0, lastColon)
    const sig = decoded.slice(lastColon + 1)
    const expected = signHmac(payload, config.sessionSecret)
    if (!constantTimeStringEqual(sig, expected)) return null
    const colonIdx = payload.indexOf(":")
    if (colonIdx < 0) return null
    const username = payload.slice(0, colonIdx)
    const expiresAtStr = payload.slice(colonIdx + 1)
    if (!USERNAME_PATTERN.test(username) || !expiresAtStr) return null
    const expiresAt = Number(expiresAtStr)
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null
    return { username }
  } catch {
    return null
  }
}

function signHmac(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

/**
 * Constant-time string compare. Pads to a common length (the longer of the
 * two) so length differences don't short-circuit. Used only on bounded-size
 * inputs (usernames, hex digests) where padding isn't a memory concern.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8")
  const bBuf = Buffer.from(b, "utf8")
  const max = Math.max(aBuf.length, bBuf.length)
  const padA = Buffer.alloc(max)
  const padB = Buffer.alloc(max)
  aBuf.copy(padA)
  bBuf.copy(padB)
  // Length still matters for correctness — if lengths differ, the answer is
  // false regardless. Mix in a length check after the constant-time compare
  // so a timing observer can't tell length differences from content differences.
  const eq = crypto.timingSafeEqual(padA, padB)
  return eq && aBuf.length === bBuf.length
}

function base64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url")
}
