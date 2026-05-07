"use client"

export type Status =
  | "active" | "completed" | "errored"
  | "success" | "error" | "aborted"
  | "running" | "pending"

export function StatusBadge({ status }: { status: string }): React.ReactNode {
  const cls = `status-badge status-badge--${normalize(status)}`
  return (
    <span className={cls}>
      <span className="status-badge-dot" />
      {status}
    </span>
  )
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "-")
}
