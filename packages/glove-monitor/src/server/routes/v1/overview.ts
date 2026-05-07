import { Hono } from "hono"
import type { MonitorStorageAdapter, TimeseriesBucket } from "../../../adapters/types.js"
import { requireScope } from "../../middleware/auth.js"

/**
 * Overview KPI cards + time-series for the dashboard. Window is half-open:
 * `since <= occurred_at < until`. Defaults: 24-hour rolling window for the
 * KPI summary; 24h hourly + 7d daily are the canonical chart granularities.
 */
export function overviewRoutes(adapter: MonitorStorageAdapter): Hono {
  const app = new Hono()
  app.use("/*", requireScope("read"))

  app.get("/", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const url = new URL(c.req.url)
    const until = url.searchParams.get("until") ?? new Date().toISOString()
    const since = url.searchParams.get("since") ?? new Date(Date.parse(until) - 24 * 3600 * 1000).toISOString()
    const data = await adapter.getOverviewMetrics(auth.projectId, since, until)
    return c.json({ data: { ...data, since, until } })
  })

  app.get("/timeseries/tokens", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const opts = parseTimeseriesParams(new URL(c.req.url))
    if ("error" in opts) return c.json(opts, 400)
    const points = await adapter.listTimeseriesTokens(auth.projectId, opts)
    return c.json({ data: points, ...opts })
  })

  app.get("/timeseries/cost", async (c) => {
    const auth = c.get("auth")
    if (!auth.projectId) return c.json({ error: "project_id_required" }, 400)
    const opts = parseTimeseriesParams(new URL(c.req.url))
    if ("error" in opts) return c.json(opts, 400)
    const points = await adapter.listTimeseriesCost(auth.projectId, opts)
    return c.json({ data: points, ...opts })
  })

  return app
}

function parseTimeseriesParams(
  url: URL,
):
  | { since: string; until: string; bucket: TimeseriesBucket }
  | { error: string } {
  const bucket = (url.searchParams.get("bucket") ?? "hour") as TimeseriesBucket
  if (bucket !== "hour" && bucket !== "day") return { error: "invalid_bucket" }
  const until = url.searchParams.get("until") ?? new Date().toISOString()
  const defaultWindowMs = bucket === "hour" ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000
  const since = url.searchParams.get("since") ?? new Date(Date.parse(until) - defaultWindowMs).toISOString()
  if (Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until))) {
    return { error: "invalid_window" }
  }
  return { since, until, bucket }
}
