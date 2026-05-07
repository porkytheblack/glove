"use client"

import type { EventRow } from "../hooks/use-api"
import { JsonViewer } from "./json-viewer"
import { RelativeTime } from "./relative-time"

/**
 * Conversation timeline. Renders the discriminated `SubscriberEvent` shapes
 * from glove-core (model_response*, tool_use, tool_use_result, compaction_*,
 * hook_invoked, skill_invoked, subagent_*) into a uniform vertical thread.
 */
export function Timeline({ events }: { events: EventRow[] }): React.ReactNode {
  if (events.length === 0) return null
  return (
    <div className="timeline">
      {events.map((ev) => (
        <Item key={ev.id} ev={ev} />
      ))}
    </div>
  )
}

function Item({ ev }: { ev: EventRow }): React.ReactNode {
  const accent = pickAccent(ev)
  return (
    <div className={`timeline-item${accent ? ` timeline-item--${accent}` : ""}`}>
      <div className="timeline-item-header">
        <span className="timeline-item-type">{ev.type}</span>
        <span className="timeline-item-time"><RelativeTime iso={ev.occurredAt} /></span>
      </div>
      <div className="timeline-item-body">{renderBody(ev)}</div>
    </div>
  )
}

function pickAccent(ev: EventRow): "accent" | "error" | "success" | null {
  if (ev.type === "tool_use_result") {
    const status = (ev.payload?.result as { status?: string } | undefined)?.status
    if (status === "error") return "error"
    if (status === "success") return "success"
    return "accent"
  }
  if (ev.type === "model_response_complete" || ev.type === "model_response") return "accent"
  if (ev.type === "compaction_start" || ev.type === "compaction_end") return "accent"
  return null
}

function renderBody(ev: EventRow): React.ReactNode {
  const p = ev.payload
  switch (ev.type) {
    case "text_delta": {
      return <span style={{ whiteSpace: "pre-wrap" }}>{String(p.text ?? "")}</span>
    }
    case "model_response":
    case "model_response_complete": {
      const text = String(p.text ?? "")
      const toolCalls = (p.tool_calls as { id?: string; tool_name?: string; input_args?: unknown }[] | undefined) ?? []
      return (
        <div>
          {ev.model && <span className="timeline-tag timeline-tag--accent">{ev.model}</span>}
          {ev.tokensIn != null  && <span className="timeline-tag">in: {ev.tokensIn}</span>}
          {ev.tokensOut != null && <span className="timeline-tag">out: {ev.tokensOut}</span>}
          {ev.costMicros != null && <span className="timeline-tag">${(ev.costMicros / 1_000_000).toFixed(4)}</span>}
          {ev.latencyMs != null && <span className="timeline-tag">{ev.latencyMs}ms</span>}
          {text && <div style={{ whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>{text}</div>}
          {toolCalls.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
              </summary>
              <div style={{ marginTop: "0.5rem" }}>
                <JsonViewer value={toolCalls} defaultCollapsed />
              </div>
            </details>
          )}
        </div>
      )
    }
    case "tool_use": {
      return (
        <div>
          <span className="timeline-tag timeline-tag--accent">{String(p.name ?? "")}</span>
          <span className="timeline-tag">id: {String(p.id ?? "—")}</span>
          <details style={{ marginTop: "0.4rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-secondary)" }}>input</summary>
            <div style={{ marginTop: "0.5rem" }}><JsonViewer value={p.input} defaultCollapsed /></div>
          </details>
        </div>
      )
    }
    case "tool_use_result": {
      const result = p.result as { status?: string; data?: unknown; message?: string } | undefined
      return (
        <div>
          <span className="timeline-tag timeline-tag--accent">{String(p.tool_name ?? "")}</span>
          {result?.status && <span className="timeline-tag">{result.status}</span>}
          {ev.latencyMs != null && <span className="timeline-tag">{ev.latencyMs}ms</span>}
          {result?.message && <div style={{ marginTop: "0.4rem", color: "var(--danger)" }}>{result.message}</div>}
          <details style={{ marginTop: "0.4rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-secondary)" }}>result</summary>
            <div style={{ marginTop: "0.5rem" }}><JsonViewer value={result?.data} defaultCollapsed /></div>
          </details>
        </div>
      )
    }
    case "token_consumption": {
      const c = p.consumption as { tokens_in?: number; tokens_out?: number } | undefined
      return (
        <div>
          {c?.tokens_in  != null && <span className="timeline-tag">in: {c.tokens_in}</span>}
          {c?.tokens_out != null && <span className="timeline-tag">out: {c.tokens_out}</span>}
          <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>(observer tick)</span>
        </div>
      )
    }
    case "compaction_start":
    case "compaction_end": {
      return (
        <div>
          {p.current_token_consumption != null && (
            <span className="timeline-tag">tokens: {String(p.current_token_consumption)}</span>
          )}
          {ev.type === "compaction_end" && (p.summary_message as { text?: string } | undefined)?.text && (
            <div style={{ marginTop: "0.4rem", whiteSpace: "pre-wrap" }}>
              {String((p.summary_message as { text: string }).text)}
            </div>
          )}
        </div>
      )
    }
    case "hook_invoked":
    case "skill_invoked":
    case "subagent_invoked":
    case "subagent_completed": {
      const name    = typeof p.name    === "string" ? p.name    : null
      const source  = typeof p.source  === "string" ? p.source  : null
      const status  = typeof p.status  === "string" ? p.status  : null
      const message = typeof p.message === "string" ? p.message : null
      const prompt  = typeof p.prompt  === "string" ? p.prompt  : null
      return (
        <div>
          {name    && <span className="timeline-tag timeline-tag--accent">{name}</span>}
          {source  && <span className="timeline-tag">{source}</span>}
          {status  && <span className="timeline-tag">{status}</span>}
          {message && <div style={{ marginTop: "0.4rem", whiteSpace: "pre-wrap" }}>{message}</div>}
          {prompt  && <div style={{ marginTop: "0.4rem", color: "var(--text-secondary)", fontSize: "0.8125rem" }}>{prompt}</div>}
        </div>
      )
    }
    default:
      return <JsonViewer value={p} defaultCollapsed />
  }
}
