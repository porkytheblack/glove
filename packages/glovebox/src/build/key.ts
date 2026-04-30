import { createHash, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"

/**
 * Generate or reuse a per-app auth key. Persisted in `dist/glovebox.key`.
 *
 * v1 uses a symmetric bearer token. Rotation = regenerate + redeploy.
 */
export async function ensureAuthKey(keyPath: string): Promise<{ key: string; fingerprint: string }> {
  let key: string
  if (existsSync(keyPath)) {
    key = (await readFile(keyPath, "utf8")).trim()
    if (!key) {
      key = generateKey()
      await writeFile(keyPath, key + "\n", { mode: 0o600 })
    }
  } else {
    key = generateKey()
    await writeFile(keyPath, key + "\n", { mode: 0o600 })
  }
  return { key, fingerprint: fingerprintKey(key) }
}

export function generateKey(): string {
  return randomBytes(32).toString("base64url")
}

export function fingerprintKey(key: string): string {
  const h = createHash("sha256").update(key).digest("hex")
  return `${h.slice(0, 8)}...${h.slice(-4)}`
}

/** Constant-time comparison. */
export function verifyKey(presented: string, fingerprint: string): boolean {
  return fingerprintKey(presented) === fingerprint
}
