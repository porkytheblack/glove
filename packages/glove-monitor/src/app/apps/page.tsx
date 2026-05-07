"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useApi, type AppRow } from "../hooks/use-api"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { RelativeTime } from "../components/relative-time"
import { EmptyState } from "../components/empty-state"

export default function AppsPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const [apps, setApps] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Apps" }])
    setActiveSection("apps")
  }, [setSegments, setActiveSection])

  useEffect(() => {
    let cancelled = false
    api.listApps()
      .then((r) => { if (!cancelled) setApps(r.data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <EmptyState title="Couldn't load apps" hint={error} />

  return (
    <div>
      <h1 style={{ marginBottom: "1rem" }}>Apps</h1>
      {loading
        ? <div className="muted">Loading…</div>
        : apps.length === 0
          ? <EmptyState title="No apps yet" hint="Each glove subscriber's `app` namespace shows up here on first ingest." />
          : (
            <div className="gm-table-wrap">
              <table className="gm-table gm-table-link">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>First seen</th>
                    <th>Last seen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <tr key={a.name}>
                      <td className="font-mono">{a.name}</td>
                      <td><RelativeTime iso={a.firstSeen} /></td>
                      <td><RelativeTime iso={a.lastSeen} /></td>
                      <td className="text-right">
                        <Link href={`/conversations?app=${encodeURIComponent(a.name)}`} className="btn">
                          View conversations
                        </Link>
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
