"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { useApi, type ConversationRow, type EventRow } from "../../hooks/use-api"
import { useBreadcrumb } from "../../hooks/use-breadcrumb"
import { useMonitor } from "../../hooks/use-monitor"
import { Timeline } from "../../components/timeline"
import { StatusBadge } from "../../components/status-badge"
import { RelativeTime } from "../../components/relative-time"
import { EmptyState } from "../../components/empty-state"

export default function ConversationDetailPage(): React.ReactNode {
  const params = useParams() as { id?: string }
  const id = params.id ? decodeURIComponent(params.id) : ""
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const { events: liveEvents } = useMonitor()
  const [conv, setConv] = useState<ConversationRow | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const seenIds = useRef(new Set<string>())

  useEffect(() => {
    if (!id) return
    setSegments([
      { label: "Conversations", href: "/conversations" },
      { label: id.split(":").pop() ?? id },
    ])
    setActiveSection("conversations")
  }, [id, setSegments, setActiveSection])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([api.getConversation(id), api.listEvents(id, 5000)])
      .then(([c, e]) => {
        if (cancelled) return
        setConv(c.data)
        setEvents(e.data)
        seenIds.current = new Set(e.data.map((ev) => ev.id))
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed") })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Append live events for this conversation as they stream in. Server-sent
  // ids match the persisted ids, so de-dup on a Set.
  useEffect(() => {
    if (!conv) return
    const incoming = liveEvents
      .filter((ev) => ev.conversation_pk === conv.id)
      .filter((ev) => !seenIds.current.has(ev.id))
    if (incoming.length === 0) return
    for (const ev of incoming) seenIds.current.add(ev.id)
    setEvents((prev) => [
      ...prev,
      ...incoming.map((ev) => ({
        id: ev.id,
        conversationPk: ev.conversation_pk,
        projectId: "",
        appName: ev.app,
        conversationId: ev.conversation_id,
        subject: ev.subject,
        userId: ev.user_id,
        clientId: ev.client_id,
        type: ev.type,
        payload: ev.payload,
        model: ev.model,
        tokensIn: ev.tokens_in,
        tokensOut: ev.tokens_out,
        costMicros: ev.cost_micros,
        latencyMs: ev.latency_ms,
        occurredAt: ev.occurred_at,
        ingestedAt: ev.ingested_at,
      } satisfies EventRow)),
    ])
  }, [liveEvents, conv])

  if (error) return <EmptyState title="Couldn't load conversation" hint={error} />
  if (!conv) return <div className="muted">Loading…</div>

  return (
    <div>
      <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
        {conv.appName}
        <StatusBadge status={conv.status} />
      </h1>
      <div className="muted" style={{ fontSize: "0.8125rem", marginBottom: "1.25rem", fontFamily: "var(--font-mono)" }}>
        {conv.id}
      </div>

      <div className="gm-two-col">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ marginBottom: 0 }}>Timeline</h2>
            <div className="muted" style={{ fontSize: "0.75rem" }}>{events.length} events</div>
          </div>
          <div style={{ padding: "1rem 1.25rem" }}>
            {events.length === 0
              ? <EmptyState title="No events yet" />
              : <Timeline events={events} />}
          </div>
        </div>

        <div className="card">
          <h2>Details</h2>
          <KV k="Subject"     v={<span className="font-mono">{conv.subject}</span>} />
          <KV k="User ID"     v={conv.userId ? <span className="font-mono">{conv.userId}</span> : <span className="muted">(none)</span>} />
          <KV k="Client ID"   v={<span className="font-mono">{conv.clientId}</span>} />
          <KV k="Started"     v={<RelativeTime iso={conv.startedAt} />} />
          <KV k="Last event"  v={<RelativeTime iso={conv.lastEventAt} />} />
          <KV k="Messages"    v={conv.messageCount} />
          <KV k="Tool calls"  v={`${conv.toolCallCount}${conv.errorCount > 0 ? ` (${conv.errorCount} err)` : ""}`} />
          <KV k="Tokens in"   v={conv.totalTokensIn} />
          <KV k="Tokens out"  v={conv.totalTokensOut} />
          <KV k="Cost"        v={`$${(conv.totalCostMicros / 1_000_000).toFixed(6)}`} />
          <KV k="Models"      v={conv.modelsUsed.length === 0 ? <span className="muted">(none)</span> : conv.modelsUsed.join(", ")} />
        </div>
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }): React.ReactNode {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{v}</span>
    </div>
  )
}
