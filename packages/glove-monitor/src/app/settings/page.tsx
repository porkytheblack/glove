"use client"

import { useCallback, useEffect, useState } from "react"
import { useApi, type ApiKeyRow, type PricingRow, type ProjectRow, type RegistrationTokenRow } from "../hooks/use-api"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { EmptyState } from "../components/empty-state"
import { RelativeTime } from "../components/relative-time"

type Tab = "projects" | "tokens" | "keys" | "pricing"

export default function SettingsPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const [tab, setTab] = useState<Tab>("projects")
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Settings" }])
    setActiveSection("settings")
  }, [setSegments, setActiveSection])

  const loadProjects = useCallback(async () => {
    try {
      const r = await api.listProjects()
      setProjects(r.data)
      if (r.data.length > 0 && !activeProjectId) setActiveProjectId(r.data[0]!.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed")
    }
  }, [api, activeProjectId])

  useEffect(() => { void loadProjects() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  return (
    <div>
      <h1 style={{ marginBottom: "1rem" }}>Settings</h1>
      <div className="tabs">
        <button className={`tab${tab === "projects" ? " active" : ""}`}  onClick={() => setTab("projects")}>Projects</button>
        <button className={`tab${tab === "tokens"   ? " active" : ""}`}  onClick={() => setTab("tokens")}>Registration tokens</button>
        <button className={`tab${tab === "keys"     ? " active" : ""}`}  onClick={() => setTab("keys")}>API keys</button>
        <button className={`tab${tab === "pricing"  ? " active" : ""}`}  onClick={() => setTab("pricing")}>Pricing</button>
      </div>

      {error && <div style={{ color: "var(--danger)", marginBottom: "0.75rem" }}>{error}</div>}

      {tab !== "projects" && projects.length > 1 && (
        <div className="gm-form-row">
          <label className="gm-form-label">Project</label>
          <select className="gm-input" value={activeProjectId ?? ""} onChange={(e) => setActiveProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {tab === "projects" && <ProjectsTab projects={projects} onChange={loadProjects} />}
      {tab === "tokens"   && (activeProjectId
        ? <TokensTab projectId={activeProjectId} />
        : <EmptyState title="Create a project first" />)}
      {tab === "keys"     && (activeProjectId
        ? <KeysTab projectId={activeProjectId} />
        : <EmptyState title="Create a project first" />)}
      {tab === "pricing"  && (activeProjectId
        ? <PricingTab projectId={activeProjectId} />
        : <EmptyState title="Create a project first" />)}
    </div>
  )
}

function ProjectsTab({ projects, onChange }: { projects: ProjectRow[]; onChange: () => Promise<void> }): React.ReactNode {
  const api = useApi()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      await api.createProject({ name, slug })
      setName(""); setSlug("")
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>New project</h2>
        <form onSubmit={(e) => void create(e)}>
          <div className="gm-form-row">
            <label className="gm-form-label">Name</label>
            <input className="gm-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="gm-form-row">
            <label className="gm-form-label">Slug</label>
            <input className="gm-input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="prod-bots" required />
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: "0.8125rem", marginBottom: "0.5rem" }}>{error}</div>}
          <button className="btn btn--primary" disabled={creating}>{creating ? "Creating…" : "Create project"}</button>
        </form>
      </div>

      {projects.length === 0
        ? <EmptyState title="No projects yet" hint="Create one above to start ingesting." />
        : (
          <div className="gm-table-wrap">
            <table className="gm-table">
              <thead>
                <tr><th>Name</th><th>Slug</th><th>ID</th><th>Created</th></tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="font-mono">{p.slug}</td>
                    <td className="font-mono" style={{ fontSize: "0.75rem" }}>{p.id}</td>
                    <td><RelativeTime iso={p.createdAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

function TokensTab({ projectId }: { projectId: string }): React.ReactNode {
  const api = useApi()
  const [tokens, setTokens] = useState<RegistrationTokenRow[]>([])
  const [name, setName] = useState("")
  const [created, setCreated] = useState<{ token: string; row: RegistrationTokenRow } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setTokens((await api.listRegistrationTokens(projectId)).data) }
    catch (err) { setError(err instanceof Error ? err.message : "load failed") }
  }, [api, projectId])

  useEffect(() => { void reload() }, [reload])

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    try {
      const r = await api.createRegistrationToken(projectId, { name })
      setCreated(r.data)
      setName("")
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed")
    }
  }
  async function revoke(id: string): Promise<void> {
    if (!confirm(`Revoke this token? Existing DCR'd clients keep working.`)) return
    await api.revokeRegistrationToken(projectId, id)
    await reload()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>New registration token</h2>
        <form onSubmit={(e) => void create(e)}>
          <div className="gm-form-row">
            <label className="gm-form-label">Name</label>
            <input className="gm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-chatbot-2026" required />
          </div>
          <button className="btn btn--primary">Create</button>
        </form>
        {created && (
          <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", borderRadius: "4px" }}>
            <div className="gm-form-label">Token (shown once)</div>
            <code style={{ wordBreak: "break-all", fontSize: "0.8125rem" }}>{created.token}</code>
          </div>
        )}
        {error && <div style={{ color: "var(--danger)", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{error}</div>}
      </div>

      {tokens.length === 0
        ? <EmptyState title="No tokens yet" />
        : (
          <div className="gm-table-wrap">
            <table className="gm-table">
              <thead>
                <tr><th>Name</th><th>Prefix</th><th>Created</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="font-mono">{t.tokenPrefix}…</td>
                    <td><RelativeTime iso={t.createdAt} /></td>
                    <td>{t.revoked ? <span className="muted">revoked</span> : <span style={{ color: "var(--accent)" }}>active</span>}</td>
                    <td className="text-right">
                      {!t.revoked && <button className="btn btn--danger" onClick={() => void revoke(t.id)}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

function KeysTab({ projectId }: { projectId: string }): React.ReactNode {
  const api = useApi()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [name, setName] = useState("")
  const [scope, setScope] = useState<"read" | "admin">("read")
  const [created, setCreated] = useState<{ key: string; row: ApiKeyRow } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setKeys((await api.listApiKeys(projectId)).data) }
    catch (err) { setError(err instanceof Error ? err.message : "load failed") }
  }, [api, projectId])

  useEffect(() => { void reload() }, [reload])

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    try {
      const r = await api.createApiKey(projectId, { name, scopes: [scope] })
      setCreated(r.data)
      setName("")
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed")
    }
  }
  async function revoke(id: string): Promise<void> {
    if (!confirm("Revoke API key?")) return
    await api.revokeApiKey(projectId, id)
    await reload()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>New API key</h2>
        <form onSubmit={(e) => void create(e)}>
          <div className="gm-form-row">
            <label className="gm-form-label">Name</label>
            <input className="gm-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="gm-form-row">
            <label className="gm-form-label">Scope</label>
            <select className="gm-input" value={scope} onChange={(e) => setScope(e.target.value as "read" | "admin")}>
              <option value="read">read</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button className="btn btn--primary">Create</button>
        </form>
        {created && (
          <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--accent-glow)", border: "1px solid var(--accent-dim)", borderRadius: "4px" }}>
            <div className="gm-form-label">Key (shown once)</div>
            <code style={{ wordBreak: "break-all", fontSize: "0.8125rem" }}>{created.key}</code>
          </div>
        )}
        {error && <div style={{ color: "var(--danger)", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{error}</div>}
      </div>

      {keys.length === 0
        ? <EmptyState title="No keys yet" />
        : (
          <div className="gm-table-wrap">
            <table className="gm-table">
              <thead>
                <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th></th></tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="font-mono">{k.keyPrefix}…</td>
                    <td className="font-mono" style={{ fontSize: "0.8125rem" }}>{k.scopes.join(", ")}</td>
                    <td><RelativeTime iso={k.createdAt} /></td>
                    <td><RelativeTime iso={k.lastUsed} /></td>
                    <td className="text-right">
                      {!k.revoked && <button className="btn btn--danger" onClick={() => void revoke(k.id)}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

function PricingTab({ projectId }: { projectId: string }): React.ReactNode {
  const api = useApi()
  const [rates, setRates] = useState<PricingRow[]>([])
  const [model, setModel] = useState("")
  const [inRate, setInRate] = useState("")
  const [outRate, setOutRate] = useState("")
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setRates((await api.listPricing(projectId)).data) }
    catch (err) { setError(err instanceof Error ? err.message : "load failed") }
  }, [api, projectId])

  useEffect(() => { void reload() }, [reload])

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    try {
      await api.setPricing(projectId, {
        model: model.trim().toLowerCase(),
        inputPer1kMicros: Math.round(Number(inRate) * 1_000_000),
        outputPer1kMicros: Math.round(Number(outRate) * 1_000_000),
      })
      setModel(""); setInRate(""); setOutRate("")
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed")
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>Set pricing rate</h2>
        <div className="muted" style={{ fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          Rates entered in <strong>USD per 1k tokens</strong>. Stored as integer micros internally.
        </div>
        <form onSubmit={(e) => void save(e)}>
          <div className="gm-form-row">
            <label className="gm-form-label">Model</label>
            <input className="gm-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-7" required />
          </div>
          <div className="gm-three-col">
            <div className="gm-form-row">
              <label className="gm-form-label">Input $/1k</label>
              <input className="gm-input" type="number" step="0.001" value={inRate} onChange={(e) => setInRate(e.target.value)} required />
            </div>
            <div className="gm-form-row">
              <label className="gm-form-label">Output $/1k</label>
              <input className="gm-input" type="number" step="0.001" value={outRate} onChange={(e) => setOutRate(e.target.value)} required />
            </div>
          </div>
          <button className="btn btn--primary">Save</button>
        </form>
        {error && <div style={{ color: "var(--danger)", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{error}</div>}
      </div>

      {rates.length === 0
        ? <EmptyState title="No pricing overrides" hint="Defaults apply for known models. Add an override to fix or extend." />
        : (
          <div className="gm-table-wrap">
            <table className="gm-table">
              <thead>
                <tr><th>Model</th><th className="text-right">Input $/1k</th><th className="text-right">Output $/1k</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.model}>
                    <td className="font-mono">{r.model}</td>
                    <td className="text-right gm-table-num">${(r.inputPer1kMicros / 1_000_000).toFixed(4)}</td>
                    <td className="text-right gm-table-num">${(r.outputPer1kMicros / 1_000_000).toFixed(4)}</td>
                    <td><RelativeTime iso={r.updatedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
