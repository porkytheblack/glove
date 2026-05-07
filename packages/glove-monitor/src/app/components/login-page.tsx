"use client"

import { useState } from "react"
import { login } from "../hooks/use-api"
import { useLoginCallback } from "./auth-provider"
import { GloveLogo } from "./glove-logo"

export function LoginPage(): React.ReactNode {
  const onSuccess = useLoginCallback()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username, password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="gm-sidebar-brand-mark"><GloveLogo size={20} /></span>
          <span>Glove Monitor</span>
        </div>
        <form onSubmit={(e) => void submit(e)}>
          <div className="gm-form-row">
            <label className="gm-form-label" htmlFor="username">Username</label>
            <input
              id="username"
              className="gm-input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="gm-form-row">
            <label className="gm-form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="gm-input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div style={{ color: "var(--danger)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>{error}</div>
          )}
          <button type="submit" className="btn btn--primary" disabled={submitting} style={{ width: "100%", justifyContent: "center" }}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
          Glove Monitor reads telemetry from connected agents via DCR'd OAuth clients. Configure in <code>defineConfig({"{ auth }"})</code>.
        </div>
      </div>
    </div>
  )
}
