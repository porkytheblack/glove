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
    const win = parseWindow(new URL(c.req.url), 24 * 3600 * 1000)
    if ("error" in win) return c.json(win, 400)
    const data = await adapter.getOverviewMetrics(auth.projectId, win.since, win.until)
    return c.json({ data: { ...data, since: win.since, until: win.until } })
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

/**
 * Parse `?since=&until=` into a validated half-open window. Validate **before**
 * doing arithmetic so a malformed `until` surfaces as 400 instead of cascading
 * a `Date.parse(...) → NaN → new Date(NaN).toISOString()` throw into a 500.
 */
function parseWindow(url: URL, defaultWindowMs: number): { since: string; until: string } | { error: string } {
  const rawUntil = url.searchParams.get("until")
  const rawSince = url.searchParams.get("since")
  if (rawUntil != null && Number.isNaN(Date.parse(rawUntil))) return { error: "invalid_until" }
  if (rawSince != null && Number.isNaN(Date.parse(rawSince))) return { error: "invalid_since" }
  const until = rawUntil ?? new Date().toISOString()
  const since = rawSince ?? new Date(Date.parse(until) - defaultWindowMs).toISOString()
  if (Date.parse(since) >= Date.parse(until)) return { error: "invalid_window" }
  return { since, until }
}

function parseTimeseriesParams(
  url: URL,
):
  | { since: string; until: string; bucket: TimeseriesBucket }
  | { error: string } {
  const bucket = (url.searchParams.get("bucket") ?? "hour") as TimeseriesBucket
  if (bucket !== "hour" && bucket !== "day") return { error: "invalid_bucket" }
  const defaultWindowMs = bucket === "hour" ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000
  const win = parseWindow(url, defaultWindowMs)
  if ("error" in win) return win
  return { ...win, bucket }
}
