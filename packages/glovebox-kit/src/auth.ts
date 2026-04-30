import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Compute the same SHA-256 fingerprint the build CLI puts in the manifest.
 */
export function fingerprintKey(key: string): string {
  const h = createHash("sha256").update(key).digest("hex")
  return `${h.slice(0, 8)}...${h.slice(-4)}`
}

/**
 * Constant-time check of a presented bearer token against the configured
 * key. We compare the *raw key* against the configured key, not the
 * fingerprint — fingerprints leak nothing, but verifying against the
 * fingerprint alone would be insecure (only 12 chars of hash). The configured
 * key is loaded from `GLOVEBOX_KEY` env var.
 */
export function verifyBearer(presented: string, configured: string): boolean {
  const a = Buffer.from(presented, "utf8")
  const b = Buffer.from(configured, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Verify that the bearer matches the manifest fingerprint *and* the configured key. */
export function verifyAgainstManifest(
  presented: string,
  configuredKey: string,
  manifestFingerprint: string,
): boolean {
  if (fingerprintKey(configuredKey) !== manifestFingerprint) return false
  return verifyBearer(presented, configuredKey)
}
