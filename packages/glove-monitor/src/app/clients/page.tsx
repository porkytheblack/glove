"use client"

import { useEffect, useState } from "react"
import { useApi, type ClientRow } from "../hooks/use-api"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { RelativeTime } from "../components/relative-time"
import { StatusBadge } from "../components/status-badge"
import { EmptyState } from "../components/empty-state"

export default function ClientsPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Clients" }])
    setActiveSection("clients")
  }, [setSegments, setActiveSection])

  async function reload(): Promise<void> {
    setLoading(true)
    try {
      const r = await api.listClients()
      setClients(r.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function revoke(id: string): Promise<void> {
    if (!confirm(`Revoke client ${id}? It will need to re-DCR with a valid registration token.`)) return
    try {
      await api.revokeClient(id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke failed")
    }
  }

  if (error) return <EmptyState title="Couldn't load clients" hint={error} />

  return (
    <div>
      <h1 style={{ marginBottom: "1rem" }}>Clients</h1>
      <div className="muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
        DCR'd OAuth clients (one per glove instance, or one per backend relay).
      </div>
      {loading
        ? <div className="muted">Loading…</div>
        : clients.length === 0
          ? <EmptyState title="No clients registered yet" hint="Subscribers register on first ingest using their registration token." />
          : (
            <div className="gm-table-wrap">
              <table className="gm-table">
                <thead>
                  <tr>
                    <th>Client ID</th>
                    <th>Name</th>
                    <th>Software</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last seen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono" style={{ fontSize: "0.75rem" }}>{c.id}</td>
                      <td>{c.name ?? <span className="muted">(none)</span>}</td>
                      <td>{c.softwareId ?? <span className="muted">(none)</span>}</td>
                      <td><StatusBadge status={c.revoked ? "revoked" : "active"} /></td>
                      <td><RelativeTime iso={c.createdAt} /></td>
                      <td><RelativeTime iso={c.lastSeen} /></td>
                      <td className="text-right">
                        {!c.revoked && (
                          <button className="btn btn--danger" onClick={() => void revoke(c.id)}>
                            Revoke
                          </button>
                        )}
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
