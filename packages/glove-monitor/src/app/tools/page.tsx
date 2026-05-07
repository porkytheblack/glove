"use client"

import { useEffect, useState } from "react"
import { useApi, type ToolStat } from "../hooks/use-api"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { EmptyState } from "../components/empty-state"

export default function ToolsPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const [tools, setTools] = useState<ToolStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Tools" }])
    setActiveSection("tools")
  }, [setSegments, setActiveSection])

  useEffect(() => {
    let cancelled = false
    api.listTools()
      .then((r) => { if (!cancelled) setTools(r.data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <EmptyState title="Couldn't load tools" hint={error} />

  return (
    <div>
      <h1 style={{ marginBottom: "1rem" }}>Tools</h1>
      {loading
        ? <div className="muted">Loading…</div>
        : tools.length === 0
          ? <EmptyState title="No tool calls yet" hint="Tools will appear once an agent invokes them." />
          : (
            <div className="gm-table-wrap">
              <table className="gm-table">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Errors</th>
                    <th className="text-right">Error rate</th>
                    <th className="text-right">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t) => {
                    const rate = t.count === 0 ? 0 : (t.errorCount / t.count) * 100
                    return (
                      <tr key={t.toolName}>
                        <td className="font-mono">{t.toolName}</td>
                        <td className="text-right gm-table-num">{t.count}</td>
                        <td className="text-right gm-table-num" style={{ color: t.errorCount > 0 ? "var(--danger)" : undefined }}>
                          {t.errorCount}
                        </td>
                        <td className="text-right gm-table-num" style={{ color: rate > 5 ? "var(--danger)" : undefined }}>
                          {rate.toFixed(1)}%
                        </td>
                        <td className="text-right gm-table-num">{t.avgLatencyMs == null ? "—" : `${t.avgLatencyMs}ms`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
    </div>
  )
}
