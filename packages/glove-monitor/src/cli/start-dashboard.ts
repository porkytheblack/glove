import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { MonitorConfig } from "../config/schema.js"

export interface StartedDashboard {
  /** The child Node process running the Next standalone server. */
  child: ChildProcess
  /** Resolved port the dashboard is listening on. */
  port: number
  /** Tear down: SIGTERM, then SIGKILL after a grace period. */
  close: () => Promise<void>
}

/**
 * Spawn the Next.js dashboard. Resolves the standalone server entry
 * relative to the built `dist/` location (`../.next/standalone/.../server.js`)
 * so it works both from a workspace dev build and from an npm-installed
 * `node_modules/glove-monitor/`. The child inherits stdio so its log lines
 * show up alongside the Hono server's.
 */
export function startDashboard(config: Pick<MonitorConfig, "dashboardPort" | "host" | "apiUrl" | "port">): StartedDashboard {
  const port = config.dashboardPort
  const apiUrl = config.apiUrl ?? `http://${config.host}:${config.port}`

  const serverPath = resolveNextStandalone()
  if (!serverPath) {
    throw new Error(
      "Couldn't find the Next.js standalone server.\n" +
      "Expected at `<glove-monitor>/.next/standalone/packages/glove-monitor/server.js`.\n" +
      "Did you `pnpm --filter glove-monitor build` first?",
    )
  }

  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: config.host,
      // Next reads this in next.config.mjs:rewrites() to know where to forward /api/*.
      GLOVE_MONITOR_API_URL: apiUrl,
    },
    stdio: "inherit",
    cwd: dirname(serverPath),
  })

  console.log(`[glove-monitor] dashboard listening on http://${config.host}:${port}`)
  console.log(`  → /api/* rewrites to ${apiUrl}`)

  return {
    child,
    port,
    close: () => new Promise<void>((res) => {
      if (child.exitCode !== null) return res()
      const onExit = (): void => res()
      child.once("exit", onExit)
      child.kill("SIGTERM")
      // Force-kill after 5s if it didn't shut down cleanly.
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL")
      }, 5_000)
      child.once("exit", () => clearTimeout(timer))
    }),
  }
}

/**
 * Locate the Next standalone server entry. The CLI runs from `dist/cli-main.js`
 * (or `dist/cli/start-dashboard.js`), so the standalone tree sits at
 * `<package>/.next/standalone/packages/glove-monitor/server.js`. Walk up from
 * the current module URL to find the package root.
 */
function resolveNextStandalone(): string | null {
  // import.meta.url example: file:///.../glove-monitor/dist/cli-main.js
  // Package root: file:///.../glove-monitor/
  const here = fileURLToPath(import.meta.url)
  // dist/cli/start-dashboard.js → walk up two dirs to dist's parent
  let dir = dirname(here)
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".next/standalone/packages/glove-monitor/server.js")
    if (existsSync(candidate)) return candidate
    const next = dirname(dir)
    if (next === dir) break
    dir = next
  }
  return null
}
