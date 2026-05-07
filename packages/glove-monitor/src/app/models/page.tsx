"use client"

import { useEffect, useState } from "react"
import { useApi, type ModelStat } from "../hooks/use-api"
import { useBreadcrumb } from "../hooks/use-breadcrumb"
import { EmptyState } from "../components/empty-state"

export default function ModelsPage(): React.ReactNode {
  const api = useApi()
  const { setSegments, setActiveSection } = useBreadcrumb()
  const [models, setModels] = useState<ModelStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSegments([{ label: "Models" }])
    setActiveSection("models")
  }, [setSegments, setActiveSection])

  useEffect(() => {
    let cancelled = false
    api.listModels()
      .then((r) => { if (!cancelled) setModels(r.data.sort((a, b) => b.costMicros - a.costMicros)) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "load failed") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <EmptyState title="Couldn't load models" hint={error} />
  return (
    <div>
      <h1 style={{ marginBottom: "1rem" }}>Models</h1>
      {loading
        ? <div className="muted">Loading…</div>
        : models.length === 0
          ? <EmptyState title="No model usage yet" hint="Models will appear once a `model_response_complete` event is ingested." />
          : (
            <div className="gm-table-wrap">
              <table className="gm-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="text-right">Conversations</th>
                    <th className="text-right">Tokens in</th>
                    <th className="text-right">Tokens out</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.model}>
                      <td className="font-mono">{m.model}</td>
                      <td className="text-right gm-table-num">{m.conversations}</td>
                      <td className="text-right gm-table-num">{m.tokensIn.toLocaleString()}</td>
                      <td className="text-right gm-table-num">{m.tokensOut.toLocaleString()}</td>
                      <td className="text-right gm-table-num">${(m.costMicros / 1_000_000).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  )
}
