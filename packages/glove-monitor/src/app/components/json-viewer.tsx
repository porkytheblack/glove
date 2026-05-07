"use client"

import { useState } from "react"

/**
 * Compact JSON viewer with collapsible objects/arrays. Deliberately
 * dependency-free — Prism / shiki / etc. would bloat the dashboard bundle for
 * what's basically syntax highlighting of stored payloads.
 */
export function JsonViewer({ value, defaultCollapsed = false }: { value: unknown; defaultCollapsed?: boolean }): React.ReactNode {
  return (
    <pre className="json-viewer">
      <Node value={value} depth={0} defaultCollapsed={defaultCollapsed} />
    </pre>
  )
}

function Node({ value, depth, defaultCollapsed }: { value: unknown; depth: number; defaultCollapsed: boolean }): React.ReactNode {
  if (value === null) return <span className="json-null">null</span>
  if (typeof value === "boolean") return <span className="json-bool">{String(value)}</span>
  if (typeof value === "number") return <span className="json-number">{value}</span>
  if (typeof value === "string") return <span className="json-string">{JSON.stringify(value)}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>
    return <Block open="[" close="]" items={value.map((v, i) => ({ key: String(i), val: v }))} depth={depth} defaultCollapsed={defaultCollapsed} />
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span>{"{}"}</span>
    return <Block open="{" close="}" items={entries.map(([key, val]) => ({ key, val }))} depth={depth} defaultCollapsed={defaultCollapsed} renderKey />
  }
  return <span>{String(value)}</span>
}

function Block({
  open, close, items, depth, defaultCollapsed, renderKey,
}: {
  open: string
  close: string
  items: { key: string; val: unknown }[]
  depth: number
  defaultCollapsed: boolean
  renderKey?: boolean
}): React.ReactNode {
  const [collapsed, setCollapsed] = useState(defaultCollapsed && depth >= 0 ? false : depth >= 3)
  const indent = "  ".repeat(depth + 1)
  const closeIndent = "  ".repeat(depth)

  if (collapsed) {
    return (
      <>
        {open}
        <button className="json-toggle" onClick={() => setCollapsed(false)}>… ({items.length})</button>
        {close}
      </>
    )
  }
  return (
    <>
      {open}
      <button className="json-toggle" onClick={() => setCollapsed(true)}>−</button>
      {"\n"}
      {items.map((item, i) => (
        <span key={item.key}>
          {indent}
          {renderKey && (
            <>
              <span className="json-key">{JSON.stringify(item.key)}</span>: {" "}
            </>
          )}
          <Node value={item.val} depth={depth + 1} defaultCollapsed={defaultCollapsed} />
          {i < items.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      {closeIndent}{close}
    </>
  )
}
