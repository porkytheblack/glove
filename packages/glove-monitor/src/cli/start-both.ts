import type { MonitorUserConfig } from "../config/schema.js"
import { startDashboard, type StartedDashboard } from "./start-dashboard.js"
import { startServer, type StartedServer } from "./start-server.js"

export interface StartedBoth {
  server: StartedServer
  dashboard: StartedDashboard
  /** Tear down both children in the right order (dashboard first, then Hono). */
  close: () => Promise<void>
}

/**
 * Boot the Hono API server and the Next.js dashboard side-by-side. The
 * dashboard is spawned with `GLOVE_MONITOR_API_URL` pointing at the
 * just-started Hono server so its `next.config.mjs` rewrites work without
 * any additional config from the user.
 */
export async function startBoth(input: MonitorUserConfig): Promise<StartedBoth> {
  const server = await startServer(input)
  const config = server.config
  const dashboard = startDashboard({
    dashboardPort: config.dashboardPort,
    host: config.host,
    port: config.port,
    apiUrl: config.apiUrl ?? `http://${config.host}:${config.port}`,
  })

  return {
    server,
    dashboard,
    close: async () => {
      // Stop the dashboard first so it stops issuing API calls into a
      // half-shutdown Hono.
      await dashboard.close()
      await server.close()
    },
  }
}
