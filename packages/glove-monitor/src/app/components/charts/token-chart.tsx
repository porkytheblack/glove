"use client"

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import type { TokenSeriesPoint } from "../../hooks/use-api"

export function TokenChart({ points }: { points: TokenSeriesPoint[] }): React.ReactNode {
  if (points.length === 0) {
    return <div className="muted" style={{ padding: "2rem 0", textAlign: "center" }}>no token activity in window</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="tokenIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="var(--accent)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="tokenOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="var(--accent-soft)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--accent-soft)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={fmtBucket} tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtNum} />
        <Tooltip labelFormatter={fmtBucket} formatter={(v: number) => fmtNum(v)} />
        <Area type="monotone" dataKey="tokensIn"  stroke="var(--accent)"      fill="url(#tokenIn)"  strokeWidth={1.5} />
        <Area type="monotone" dataKey="tokensOut" stroke="var(--accent-soft)" fill="url(#tokenOut)" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function fmtBucket(b: string): string {
  if (typeof b !== "string") return String(b)
  // YYYY-MM-DDTHH:00:00Z → MM-DD HH:00 ; YYYY-MM-DDT00:00:00Z → MM-DD
  const d = new Date(b)
  if (Number.isNaN(d.getTime())) return b
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" })
}
function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
