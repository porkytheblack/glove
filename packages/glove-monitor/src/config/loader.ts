import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { MonitorUserConfig } from "./schema.js"

/**
 * Filenames tried in order. `gmonitor.config.*` is the canonical short form;
 * `glove-monitor.config.*` is accepted as a fallback for projects that
 * already use the long name.
 */
const CONFIG_NAMES = [
  "gmonitor.config.ts",
  "gmonitor.config.js",
  "gmonitor.config.mjs",
  "glove-monitor.config.ts",
  "glove-monitor.config.js",
  "glove-monitor.config.mjs",
]

export interface LoadConfigResult {
  config: MonitorUserConfig
  /** Absolute path of the file actually loaded; null if no config was found. */
  source: string | null
}

/**
 * Discover and load the user's config file. The CLI shim re-execs with
 * `node --import tsx`, so `.ts` configs `await import()` cleanly here without
 * any extra loader plumbing.
 *
 * Throws on a malformed config (syntax error, default export missing) — the
 * caller surfaces that to the user as a startup failure rather than booting
 * with silent defaults.
 */
export async function loadConfig(cwd: string, explicitPath?: string): Promise<LoadConfigResult> {
  const candidate = explicitPath ? resolve(cwd, explicitPath) : findConfig(cwd)
  if (!candidate) return { config: {}, source: null }
  if (!existsSync(candidate)) {
    throw new Error(`Config file not found: ${candidate}`)
  }
  const url = pathToFileURL(candidate).href
  const mod = await import(url) as { default?: MonitorUserConfig }
  const raw = mod.default ?? (mod as MonitorUserConfig)
  if (raw == null || typeof raw !== "object") {
    throw new Error(`Config file ${candidate} did not export an object (use \`export default defineConfig({...})\`)`)
  }
  return { config: raw, source: candidate }
}

function findConfig(cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    const p = resolve(cwd, name)
    if (existsSync(p)) return p
  }
  return null
}
