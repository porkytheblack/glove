"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useApi, type CostSeriesPoint, type OverviewMetrics, type ToolStat, type AppRow, type TokenSeriesPoint } from "./hooks/use-api"
import { useBreadcrumb } from "./hooks/use-breadcrumb"
import { useMonitor } from "./hooks/use-monitor"
import { TokenChart } from "./components/charts/token-chart"
import { CostChart } from "./components/charts/cost-chart"
import { EmptyState } from "./components/empty-state"
import { RelativeTime } from "./components/relative-time"
import { PulseDot } from "./components/pulse-dot"

export default function OverviewPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const { events: liveEvents } = useMonitor()
  const [overview, setOverview] = useState<OverviewMetrics | null>(null)
  const [tokenSeries, setTokenSeries] = useState<TokenSeriesPoint[]>([])
  const [costSeries, setCostSeries]   = useState<CostSeriesPoint[]>([])
  const [tools, setTools] = useState<ToolStat[]>([])
  const [apps, setApps]   = useState<AppRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Overview" }])
    setActiveSection("overview")
  }, [setSegments, setActiveSection])

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const [o, t24, c7, ts, ap] = await Promise.all([
          api.getOverview(),
          api.listTokenSeries({ bucket: "hour" }),
          api.listCostSeries({ bucket: "day" }),
          api.listTools(),
          api.listApps(),
        ])
        if (cancelled) return
        setOverview(o.data)
        setTokenSeries(t24.data)
        setCostSeries(c7.data)
        setTools(ts.data)
        setApps(ap.data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load")
      }
    }
    void load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const errorRate = useMemo(() => {
    if (!overview || overview.toolCalls === 0) return 0
    return (overview.toolErrors / overview.toolCalls) * 100
  }, [overview])

  if (error) {
    return <EmptyState title="Couldn't load overview" hint={error} />
  }

  return (
    <div>
      <h1 style={{ marginBottom: "0.25rem" }}>Overview</h1>
      <div className="muted" style={{ marginBottom: "1.25rem", fontSize: "0.875rem" }}>
        last 24 hours · {overview ? new Date(overview.since).toLocaleString() : "—"} → now
      </div>

      <div className="stat-grid">
        <Stat label="Conversations 24h" value={overview ? overview.conversationsInWindow : "—"} />
        <Stat label="Active now"        value={overview ? overview.activeNow : "—"} accent={overview && overview.activeNow > 0 ? <PulseDot /> : undefined} />
        <Stat label="Tokens in 24h"     value={overview ? fmtCompact(overview.tokensIn) : "—"} />
        <Stat label="Tokens out 24h"    value={overview ? fmtCompact(overview.tokensOut) : "—"} />
        <Stat label="Cost 24h"          value={overview ? `$${(overview.costMicros / 1_000_000).toFixed(4)}` : "—"} />
        <Stat label="Tool error rate"   value={overview ? `${errorRate.toFixed(1)}%` : "—"} sub={overview ? `${overview.toolErrors} / ${overview.toolCalls}` : undefined} />
      </div>

      <div className="gm-two-col">
        <div className="flex flex-col gap-4">
          <div className="card">
            <h2>Tokens (last 24h, hourly)</h2>
            <TokenChart points={tokenSeries} />
          </div>
          <div className="card">
            <h2>Cost (last 7d, daily)</h2>
            <CostChart points={costSeries} />
          </div>
          <div className="gm-three-col">
            <div className="card">
              <h2>Top tools</h2>
              {tools.length === 0
                ? <div className="muted" style={{ fontSize: "0.875rem", padding: "1rem 0" }}>No tool calls yet.</div>
                : (
                  <table className="gm-table">
                    <thead>
                      <tr><th>Tool</th><th className="text-right">Calls</th><th className="text-right">Errors</th></tr>
                    </thead>
                    <tbody>
                      {tools.slice(0, 5).map((t) => (
                        <tr key={t.toolName}>
                          <td>{t.toolName}</td>
                          <td className="text-right gm-table-num">{t.count}</td>
                          <td className="text-right gm-table-num" style={{ color: t.errorCount > 0 ? "var(--danger)" : undefined }}>{t.errorCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
            <div className="card">
              <h2>Top apps</h2>
              {apps.length === 0
                ? <div className="muted" style={{ fontSize: "0.875rem", padding: "1rem 0" }}>No apps yet.</div>
                : (
                  <table className="gm-table">
                    <thead>
                      <tr><th>App</th><th>Last seen</th></tr>
                    </thead>
                    <tbody>
                      {apps.slice(0, 5).map((a) => (
                        <tr key={a.name}>
                          <td>{a.name}</td>
                          <td><RelativeTime iso={a.lastSeen} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Live activity</h2>
          {liveEvents.length === 0
            ? <EmptyState title="Waiting for events" hint="Connect an agent to start streaming." />
            : (
              <div className="activity-feed">
                {liveEvents.slice(0, 30).map((ev) => (
                  <Link key={ev.id} href={`/conversations/${encodeURIComponent(ev.conversation_pk)}`} style={{ color: "inherit" }}>
                    <div className="activity-item">
                      <span className="activity-time"><RelativeTime iso={ev.occurred_at} /></span>
                      <span className="activity-type">{ev.type}</span>
                      <span className="activity-detail">
                        {ev.app} · {ev.subject}
                        {ev.model && ` · ${ev.model}`}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: React.ReactNode }): React.ReactNode {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {value} {accent}
      </div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  )
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
