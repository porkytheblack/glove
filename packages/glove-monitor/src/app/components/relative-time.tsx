"use client"

import { useEffect, useState } from "react"

/**
 * Renders a relative time string ("3s ago", "5m ago") that re-renders every
 * minute (every 5s when fresh) so live conversation rows feel alive without
 * resorting to a global tick.
 */
export function RelativeTime({ iso, fallback = "—" }: { iso?: string | null; fallback?: string }): React.ReactNode {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!iso) return
    const ageSec = (Date.now() - Date.parse(iso)) / 1000
    const intervalMs = ageSec < 60 ? 5_000 : ageSec < 3600 ? 30_000 : 60_000
    const id = setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => clearInterval(id)
  }, [iso])

  if (!iso) return <span className="muted">{fallback}</span>
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return <span className="muted">{fallback}</span>
  return <span title={iso}>{format(t)}</span>
}

function format(t: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (diffSec < 5) return "just now"
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `${diffD}d ago`
  return new Date(t).toLocaleDateString()
}
