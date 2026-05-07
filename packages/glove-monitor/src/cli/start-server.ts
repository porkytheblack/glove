import { serve } from "@hono/node-server"
import { WebSocketServer } from "ws"
import { createServer } from "../server/index.js"
import type { MonitorUserConfig } from "../config/schema.js"

export interface StartedServer {
  /** Underlying HTTP server. Caller closes on shutdown. */
  http: ReturnType<typeof serve>
  /** Resolved config (defaults + env + file + flags applied). */
  config: Awaited<ReturnType<typeof createServer>>["config"]
  /** Tear down: closes the HTTP server. Returns when the close completes. */
  close: () => Promise<void>
}

/**
 * Start the Hono API server. Accepts a fully-formed `MonitorUserConfig` —
 * the caller is responsible for merging the config file, env vars, and CLI
 * flags before calling this. WebSocket upgrade for `/api/events` is wired
 * here (lifted verbatim from the previous one-shot cli.ts).
 */
export async function startServer(input: MonitorUserConfig): Promise<StartedServer> {
  const { app, config, wsHub } = await createServer(input)

  const http = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  })

  // WebSocket upgrade for dashboard internals at /api/events.
  const wss = new WebSocketServer({ noServer: true })
  ;(http as unknown as { on: (e: string, cb: (req: unknown, sock: unknown, head: unknown) => void) => void }).on(
    "upgrade",
    (req: unknown, socket: unknown, head: unknown) => {
      const url = (req as { url?: string }).url ?? ""
      if (!url.startsWith("/api/events")) {
        ;(socket as { destroy: () => void }).destroy()
        return
      }
      wss.handleUpgrade(
        req as Parameters<WebSocketServer["handleUpgrade"]>[0],
        socket as Parameters<WebSocketServer["handleUpgrade"]>[1],
        head as Parameters<WebSocketServer["handleUpgrade"]>[2],
        (ws) => {
          const u = new URL(url, "http://localhost")
          const projectId = u.searchParams.get("project") ?? null
          wsHub.add({ ws, projectId })
        },
      )
    },
  )

  console.log(`[glove-monitor] server listening on http://${config.host}:${config.port}`)
  console.log(`  data dir: ${config.dataDir}`)
  if (config.auth) {
    console.log(`  auth: enabled (user: ${config.auth.username})`)
  } else if (config.allowAnonymousAdmin) {
    console.log("  auth: anonymous-admin (development mode)")
  } else {
    console.log("  auth: disabled — read endpoints will require API keys")
  }

  return {
    http,
    config,
    close: () => new Promise<void>((res) => {
      wss.close()
      ;(http as unknown as { close: (cb: () => void) => void }).close(() => res())
    }),
  }
}
