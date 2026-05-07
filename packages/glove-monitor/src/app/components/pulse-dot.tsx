"use client"

export function PulseDot({ live = true, title }: { live?: boolean; title?: string }): React.ReactNode {
  return (
    <span
      title={title ?? (live ? "live" : "idle")}
      className={live ? "pulse-dot" : "status-badge-dot"}
      style={live ? undefined : { background: "var(--text-tertiary)", display: "inline-block", width: 8, height: 8, borderRadius: "50%" }}
    />
  )
}
