import { defineConfig, SqliteAdapter } from "glove-monitor"

/**
 * Local glove-monitor instance for the coffee demo. Run with `pnpm monitor`
 * (Hono on :4500, dashboard on :3030 to avoid clashing with coffee's :3000).
 *
 * `allowAnonymousAdmin: true` lets the bootstrap script create a project +
 * registration token via the admin API without going through the dashboard
 * login. It's hard-refused in production by glove-monitor's auth middleware,
 * so this is safe for the demo.
 */
export default defineConfig({
  port: 4500,
  dashboardPort: 3030,
  host: "127.0.0.1",
  dataDir: "./.glove-monitor",
  adapter: new SqliteAdapter({ dbPath: "./.glove-monitor/monitor.db" }),
  allowAnonymousAdmin: true,
  open: false,
})
