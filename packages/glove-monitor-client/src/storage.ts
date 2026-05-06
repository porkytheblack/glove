import { createHash } from "node:crypto"
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

/**
 * Persist DCR'd credentials so a Glove process restart does not re-register.
 * Default backend: a 0o600 JSON file under `~/.glove-monitor/`.
 */

export interface CachedCredentials {
  clientId: string
  clientSecret: string
  registrationAccessToken: string
  registeredAt: string
}

export interface CredentialStorage {
  load(key: string): Promise<CachedCredentials | null>
  save(key: string, creds: CachedCredentials): Promise<void>
  clear(key: string): Promise<void>
}

function isWritable(p: string): boolean {
  try { accessSync(p, fsConstants.W_OK); return true } catch { return false }
}

/**
 * Choose a writable directory for credential persistence, preferring
 * `~/.glove-monitor`. On serverless platforms (Lambda, Vercel, Cloudflare
 * Workers) the home directory is read-only or absent — fall back to a
 * `/tmp`-scoped path so cold starts can at least cache within their lifetime.
 * If neither is writable, callers should pass a `MemoryCredentialStorage`
 * explicitly; constructing `FsCredentialStorage` will throw in that case.
 */
function resolveCacheDir(preferred?: string): string {
  if (preferred) return preferred
  const home = (() => { try { return homedir() } catch { return null } })()
  if (home) {
    const dir = join(home, ".glove-monitor")
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      if (isWritable(dir)) return dir
    } catch { /* fall through */ }
  }
  // Serverless fallback. Persists across warm invocations in the same
  // container; lost on cold start. Document this explicitly so callers
  // running in those environments can pick a different storage.
  const tmp = join(tmpdir(), ".glove-monitor")
  mkdirSync(tmp, { recursive: true, mode: 0o700 })
  return tmp
}

export class FsCredentialStorage implements CredentialStorage {
  private dir: string
  constructor(dir?: string) {
    this.dir = resolveCacheDir(dir)
  }

  private pathFor(key: string): string {
    const safe = createHash("sha256").update(key).digest("hex")
    return join(this.dir, `${safe}.json`)
  }

  async load(key: string): Promise<CachedCredentials | null> {
    const p = this.pathFor(key)
    if (!existsSync(p)) return null
    try {
      const raw = readFileSync(p, "utf8")
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<CachedCredentials>
      // Validate the cache shape so a corrupted file falls through to a
      // re-DCR rather than propagating undefined fields downstream.
      if (typeof parsed.clientId !== "string" || typeof parsed.clientSecret !== "string") return null
      if (typeof parsed.registrationAccessToken !== "string") return null
      return parsed as CachedCredentials
    } catch {
      return null
    }
  }

  async save(key: string, creds: CachedCredentials): Promise<void> {
    const p = this.pathFor(key)
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
    writeFileSync(p, JSON.stringify(creds), { mode: 0o600 })
  }

  async clear(key: string): Promise<void> {
    const p = this.pathFor(key)
    if (!existsSync(p)) return
    try { unlinkSync(p) } catch { /* best-effort */ }
  }
}

export class MemoryCredentialStorage implements CredentialStorage {
  private map = new Map<string, CachedCredentials>()
  async load(key: string): Promise<CachedCredentials | null> { return this.map.get(key) ?? null }
  async save(key: string, creds: CachedCredentials): Promise<void> { this.map.set(key, creds) }
  async clear(key: string): Promise<void> { this.map.delete(key) }
}
