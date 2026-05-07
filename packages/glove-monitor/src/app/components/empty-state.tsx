"use client"

import type { ReactNode } from "react"

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): ReactNode {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 7h18M3 12h18M3 17h12" />
        </svg>
      </div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="muted" style={{ fontSize: "0.875rem" }}>{hint}</div>}
      {action && <div style={{ marginTop: "1rem" }}>{action}</div>}
    </div>
  )
}
