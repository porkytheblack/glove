"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useApi, type ConversationRow } from "../hooks/use-api"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { StatusBadge } from "../components/status-badge"
import { RelativeTime } from "../components/relative-time"
import { EmptyState } from "../components/empty-state"
import { PulseDot } from "../components/pulse-dot"

const LIVE_THRESHOLD_MS = 30 * 1000

export default function ConversationsPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const [rows, setRows] = useState<ConversationRow[]>([])
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]) // null = first page
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filters, setFilters] = useState<{ app?: string; subject?: string; status?: string }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Conversations" }])
    setActiveSection("conversations")
  }, [setSegments, setActiveSection])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.listConversations({
      ...filters,
      limit: 50,
      cursor: cursorStack[cursorStack.length - 1] ?? undefined,
    })
      .then((r) => {
        if (cancelled) return
        setRows(r.data)
        setNextCursor(r.next_cursor ?? null)
        setError(null)
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, cursorStack])

  function setFilter<K extends keyof typeof filters>(key: K, val: string): void {
    setCursorStack([null])
    setFilters((f) => ({ ...f, [key]: val || undefined }))
  }

  return (
    <div>
      <h1 style={{ marginBottom: "1rem" }}>Conversations</h1>

      <div className="filter-bar">
        <input className="gm-input" placeholder="filter by app" onChange={(e) => setFilter("app", e.target.value)} defaultValue={filters.app ?? ""} />
        <input className="gm-input" placeholder="filter by subject" onChange={(e) => setFilter("subject", e.target.value)} defaultValue={filters.subject ?? ""} />
        <select className="gm-input" onChange={(e) => setFilter("status", e.target.value)} defaultValue={filters.status ?? ""}>
          <option value="">all statuses</option>
          <option value="active">active</option>
          <option value="completed">completed</option>
          <option value="errored">errored</option>
        </select>
      </div>

      {error && <div style={{ color: "var(--danger)", marginBottom: "0.75rem" }}>{error}</div>}
      {loading && rows.length === 0
        ? <div className="muted">Loading…</div>
        : rows.length === 0
          ? <EmptyState title="No conversations yet" hint="Connect an agent and send a message." />
          : (
            <div className="gm-table-wrap">
              <table className="gm-table gm-table-link">
                <thead>
                  <tr>
                    <th></th>
                    <th>App</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th className="text-right">Msgs</th>
                    <th className="text-right">Tools</th>
                    <th className="text-right">Tokens</th>
                    <th className="text-right">Cost</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const isLive = c.status === "active" && (Date.now() - Date.parse(c.lastEventAt)) < LIVE_THRESHOLD_MS
                    return (
                      <tr key={c.id}>
                        <td style={{ width: 24 }}>{isLive && <PulseDot />}</td>
                        <td><Link href={`/conversations/${encodeURIComponent(c.id)}`}>{c.appName}</Link></td>
                        <td className="font-mono" style={{ fontSize: "0.8125rem" }}>{c.subject}</td>
                        <td><StatusBadge status={c.status} /></td>
                        <td className="text-right gm-table-num">{c.messageCount}</td>
                        <td className="text-right gm-table-num" style={{ color: c.errorCount > 0 ? "var(--danger)" : undefined }}>
                          {c.toolCallCount}{c.errorCount > 0 ? ` (${c.errorCount} err)` : ""}
                        </td>
                        <td className="text-right gm-table-num">{c.totalTokensIn + c.totalTokensOut}</td>
                        <td className="text-right gm-table-num">${(c.totalCostMicros / 1_000_000).toFixed(4)}</td>
                        <td><RelativeTime iso={c.lastEventAt} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
        <button
          className="btn"
          disabled={cursorStack.length <= 1}
          onClick={() => setCursorStack((s) => s.slice(0, -1))}
        >
          ← Prev
        </button>
        <button
          className="btn"
          disabled={!nextCursor}
          onClick={() => nextCursor && setCursorStack((s) => [...s, nextCursor])}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
