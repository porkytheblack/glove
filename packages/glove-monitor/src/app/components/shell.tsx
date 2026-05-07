"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { useAuth } from "./auth-provider"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { useMonitor } from "../hooks/use-monitor"

interface NavItem {
  label: string
  href: string
  match: (pathname: string) => boolean
  icon: ReactNode
}

const NAV: NavItem[] = [
  { label: "Overview",      href: "/",              match: (p) => p === "/",                    icon: <IconGrid /> },
  { label: "Conversations", href: "/conversations", match: (p) => p.startsWith("/conversations"), icon: <IconChat /> },
  { label: "Tools",         href: "/tools",         match: (p) => p.startsWith("/tools"),         icon: <IconWrench /> },
  { label: "Models",        href: "/models",        match: (p) => p.startsWith("/models"),        icon: <IconCpu /> },
  { label: "Apps",          href: "/apps",          match: (p) => p.startsWith("/apps"),          icon: <IconCube /> },
  { label: "Clients",       href: "/clients",       match: (p) => p.startsWith("/clients"),       icon: <IconKey /> },
  { label: "Settings",      href: "/settings",      match: (p) => p.startsWith("/settings"),      icon: <IconGear /> },
]

export function Shell({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname() ?? "/"
  const { username, logout } = useAuth()
  const { segments } = useBreadcrumb()
  const { connected } = useMonitor()
  return (
    <div className="gm-layout">
      <aside className="gm-sidebar">
        <div className="gm-sidebar-brand">
          <span className="gm-sidebar-brand-mark">G</span>
          <span>Glove Monitor</span>
        </div>
        <div className="gm-sidebar-section-label">Telemetry</div>
        <nav className="gm-sidebar-nav">
          {NAV.map((item) => {
            const isActive = item.match(pathname)
            return (
              <Link key={item.href} href={item.href} className={`gm-nav-link${isActive ? " active" : ""}`}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <div style={{ marginTop: "auto", padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            <span className={connected ? "pulse-dot" : ""} style={connected ? undefined : { width: 8, height: 8, borderRadius: "50%", background: "var(--text-tertiary)", display: "inline-block" }} />
            {connected ? "live" : "offline"}
          </div>
        </div>
      </aside>
      <main className="gm-main">
        <header className="gm-header">
          <div className="gm-header-title">
            {segments.length === 0 ? "Dashboard" : segments.map((s, i) => (
              <span key={i}>
                {i > 0 && <span style={{ margin: "0 0.5rem", color: "var(--text-tertiary)" }}>›</span>}
                {s.href ? <Link href={s.href} style={{ color: "inherit" }}>{s.label}</Link> : s.label}
              </span>
            ))}
          </div>
          <div className="gm-header-actions">
            {username && <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{username}</span>}
            <button className="btn" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>
        <div className="gm-content">{children}</div>
      </main>
    </div>
  )
}

// ─── Inline icons (no external deps) ─────────────────────────────────

function IconGrid()   { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="5" height="5"/><rect x="8" y="1" width="5" height="5"/><rect x="1" y="8" width="5" height="5"/><rect x="8" y="8" width="5" height="5"/></svg> }
function IconChat()   { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3h10v7H6l-3 2v-2H2z"/></svg> }
function IconWrench() { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9.5 1.5a3 3 0 0 0-1.7 5.4L1.5 13.2l1.3 1.3 6.3-6.3a3 3 0 0 0 .4-6.7z"/></svg> }
function IconCpu()    { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="8" height="8"/><path d="M5 3v-2M9 3v-2M5 13v-2M9 13v-2M3 5h-2M3 9h-2M13 5h-2M13 9h-2"/></svg> }
function IconCube()   { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1l6 3v6l-6 3-6-3v-6z"/><path d="M7 7v6M1 4l6 3 6-3"/></svg> }
function IconKey()    { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="4" cy="7" r="3"/><path d="M7 7h6M11 7v3M9 7v2"/></svg> }
function IconGear()   { return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="2.5"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.6 2.6l1.4 1.4M10 10l1.4 1.4M2.6 11.4L4 10M10 4l1.4-1.4"/></svg> }
