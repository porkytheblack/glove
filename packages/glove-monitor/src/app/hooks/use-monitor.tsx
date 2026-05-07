"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

export interface LiveEvent {
  id: string
  type: string
  conversation_id: string
  conversation_pk: string
  app: string
  subject: string
  user_id: string | null
  client_id: string
  occurred_at: string
  ingested_at: string
  model: string | null
  tokens_in: number | null
  tokens_out: number | null
  cost_micros: number | null
  latency_ms: number | null
  payload: Record<string, unknown>
}

interface MonitorContextValue {
  connected: boolean
  events: LiveEvent[]
}

const MonitorContext = createContext<MonitorContextValue>({ connected: false, events: [] })

export function useMonitor(): MonitorContextValue {
  return useContext(MonitorContext)
}

/**
 * Live event stream backed by the SSE endpoint at `/api/v1/events`. We use SSE
 * (not the WS dashboard hub) because the dashboard runs through the API proxy
 * and SSE rides on a normal HTTP request — no WebSocket upgrade required from
 * the Next.js dev server. Reconnects with exponential backoff on disconnect.
 */
export function MonitorProvider({ children, maxEvents = 200 }: { children: ReactNode; maxEvents?: number }): ReactNode {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const eventsRef = useRef(events)
  eventsRef.current = events

  const append = useCallback((ev: LiveEvent) => {
    setEvents((prev) => {
      const next = [ev, ...prev]
      if (next.length > maxEvents) next.length = maxEvents
      return next
    })
  }, [maxEvents])

  useEffect(() => {
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false

    function connect() {
      es = new EventSource("/api/v1/events", { withCredentials: true })
      es.onopen = () => {
        setConnected(true)
        attempts = 0
      }
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as LiveEvent
          if (data && typeof data === "object") append(data)
        } catch { /* ignore parse errors */ }
      }
      es.onerror = () => {
        setConnected(false)
        es?.close()
        es = null
        if (closed) return
        attempts++
        const delay = Math.min(1000 * Math.pow(2, Math.min(attempts, 5)), 15000)
        timer = setTimeout(connect, delay)
      }
    }
    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      es?.close()
    }
  }, [append])

  return (
    <MonitorContext.Provider value={{ connected, events }}>
      {children}
    </MonitorContext.Provider>
  )
}
