import { HELP_TEXT, parseArgs, type CliArgs } from "./cli/parse-args.js"
import { loadConfig } from "./config/loader.js"
import type { MonitorUserConfig } from "./config/schema.js"
import { startServer } from "./cli/start-server.js"
import { startDashboard } from "./cli/start-dashboard.js"
import { startBoth } from "./cli/start-both.js"

async function main(): Promise<void> {
  let args: CliArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`[glove-monitor] ${err instanceof Error ? err.message : String(err)}`)
    console.error("Run with --help for usage.")
    process.exit(2)
  }

  if (args.help) {
    console.log(HELP_TEXT)
    return
  }

  if (args.unknown.length > 0) {
    console.error(`[glove-monitor] unknown argument(s): ${args.unknown.join(" ")}`)
    console.error("Run with --help for usage.")
    process.exit(2)
  }

  // Load config file (if present) and merge CLI flag overrides.
  const { config: fileConfig, source } = await loadConfig(process.cwd(), args.configPath)
  if (source) console.log(`[glove-monitor] config: ${source}`)
  const merged: MonitorUserConfig = {
    ...fileConfig,
    ...(args.port !== undefined        ? { port: args.port }                   : {}),
    ...(args.dashboardPort !== undefined ? { dashboardPort: args.dashboardPort } : {}),
    ...(args.host !== undefined        ? { host: args.host }                   : {}),
    ...(args.dataDir !== undefined     ? { dataDir: args.dataDir }             : {}),
    ...(args.apiUrl !== undefined      ? { apiUrl: args.apiUrl }               : {}),
    ...(args.noOpen                    ? { open: false }                       : {}),
  }

  const shutdown = installShutdown()

  switch (args.command) {
    case "server": {
      const started = await startServer(merged)
      shutdown.register(() => started.close())
      break
    }
    case "dashboard": {
      // Need fully-resolved values for spawning Next; piggyback on `startServer`'s
      // resolveConfig output via a noop... actually, just call resolveConfig directly.
      const { resolveConfig } = await import("./config/schema.js")
      const resolved = resolveConfig(merged)
      const started = startDashboard({
        dashboardPort: resolved.dashboardPort,
        host: resolved.host,
        port: resolved.port,
        apiUrl: resolved.apiUrl,
      })
      shutdown.register(() => started.close())
      break
    }
    case "start": {
      const started = await startBoth(merged)
      shutdown.register(() => started.close())
      break
    }
  }
}

/**
 * Wire SIGINT/SIGTERM to a list of cleanup callbacks. The first signal calls
 * each cleanup in order, then exits 0; a second signal force-exits.
 */
function installShutdown(): { register: (cb: () => Promise<void> | void) => void } {
  const cleanups: Array<() => Promise<void> | void> = []
  let shuttingDown = false

  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      console.error(`[glove-monitor] received second ${signal}, force exit`)
      process.exit(1)
    }
    shuttingDown = true
    console.log(`[glove-monitor] ${signal} received, shutting down…`)
    void (async () => {
      for (const cb of cleanups) {
        try { await cb() } catch (err) { console.error("[glove-monitor] cleanup error:", err) }
      }
      process.exit(0)
    })()
  }

  process.on("SIGINT", handle)
  process.on("SIGTERM", handle)

  return {
    register: (cb) => { cleanups.push(cb) },
  }
}

main().catch((err) => {
  console.error("[glove-monitor] failed to start:", err)
  process.exit(1)
})
