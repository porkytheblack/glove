"use client"

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import type { CostSeriesPoint } from "../../hooks/use-api"

export function CostChart({ points }: { points: CostSeriesPoint[] }): React.ReactNode {
  if (points.length === 0) {
    return <div className="muted" style={{ padding: "2rem 0", textAlign: "center" }}>no cost data in window</div>
  }
  const data = points.map((p) => ({ ...p, costUsd: p.costMicros / 1_000_000 }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={fmtBucket} tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v.toFixed(2)}`} />
        <Tooltip labelFormatter={fmtBucket} formatter={(v: number) => `$${v.toFixed(4)}`} />
        <Bar dataKey="costUsd" fill="var(--accent)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function fmtBucket(b: string): string {
  if (typeof b !== "string") return String(b)
  const d = new Date(b)
  if (Number.isNaN(d.getTime())) return b
  return d.toLocaleString(undefined, { month: "short", day: "numeric" })
}
