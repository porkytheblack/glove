#!/usr/bin/env node
import { serve } from "@hono/node-server"
import { WebSocketServer } from "ws"
import { createServer } from "./server/index.js"
import type { MonitorUserConfig } from "./config/schema.js"

async function main(): Promise<void> {
  const userConfig: MonitorUserConfig = {}
  const { app, config, wsHub } = await createServer(userConfig)

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  })

  // WebSocket upgrade for dashboard internals at /api/events
  const wss = new WebSocketServer({ noServer: true })
  ;(server as unknown as { on: (e: string, cb: (req: unknown, sock: unknown, head: unknown) => void) => void }).on(
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
          // Project scoping comes from a query param.
          const u = new URL(url, "http://localhost")
          const projectId = u.searchParams.get("project") ?? null
          wsHub.add({ ws, projectId })
        },
      )
    },
  )

  console.log(`glove-monitor listening on http://${config.host}:${config.port}`)
  console.log(`  data dir: ${config.dataDir}`)
  if (config.auth) {
    console.log(`  auth: enabled (user: ${config.auth.username})`)
  } else {
    console.log("  auth: disabled — running without dashboard credentials")
  }
}

main().catch((err) => {
  console.error("glove-monitor failed to start:", err)
  process.exit(1)
})
