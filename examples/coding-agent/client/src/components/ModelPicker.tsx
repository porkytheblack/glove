import { useState, useEffect } from "react";

interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  models: string[];
  defaultModel: string;
}

interface Props {
  serverHttpUrl: string;
  provider?: string;
  model?: string;
  planning: boolean;
  tasking: boolean;
  autoAccept: boolean;
  onProviderChange: (provider: string | undefined) => void;
  onModelChange: (model: string | undefined) => void;
  onPlanningChange: (on: boolean) => void;
  onTaskingChange: (on: boolean) => void;
  onAutoAcceptChange: (on: boolean) => void;
}

export function ModelPicker({
  serverHttpUrl,
  provider,
  model,
  planning,
  tasking,
  autoAccept,
  onProviderChange,
  onModelChange,
  onPlanningChange,
  onTaskingChange,
  onAutoAcceptChange,
}: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${serverHttpUrl}/providers`)
      .then((r) => r.json())
      .then((data) => {
        setProviders(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [serverHttpUrl]);

  const selectedProvider = providers.find((p) => p.id === provider);
  const models = selectedProvider?.models ?? [];

  return (
    <div className="model-picker">
      <h3 className="model-picker-title">Model</h3>

      {loading ? (
        <div className="dim">Loading providers...</div>
      ) : (
        <>
          <div className="model-picker-row">
            <label className="model-picker-label">Provider</label>
            <select
              className="model-picker-select"
              value={provider ?? ""}
              onChange={(e) => {
                const val = e.target.value || undefined;
                onProviderChange(val);
                onModelChange(undefined);
              }}
            >
              <option value="">Default</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.name}{!p.available ? " (no API key)" : ""}
                </option>
              ))}
            </select>
          </div>

          {provider && models.length > 0 && (
            <div className="model-picker-row">
              <label className="model-picker-label">Model</label>
              <select
                className="model-picker-select"
                value={model ?? ""}
                onChange={(e) => onModelChange(e.target.value || undefined)}
              >
                <option value="">
                  Default ({selectedProvider?.defaultModel})
                </option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <h3 className="model-picker-title">Features</h3>
      <div className="model-picker-toggles">
        <label className="model-picker-toggle">
          <input
            type="checkbox"
            checked={planning}
            onChange={(e) => onPlanningChange(e.target.checked)}
          />
          <span>Planning mode</span>
          <span className="dim"> — present step-by-step plans for approval</span>
        </label>
        <label className="model-picker-toggle">
          <input
            type="checkbox"
            checked={tasking}
            onChange={(e) => onTaskingChange(e.target.checked)}
          />
          <span>Task tracking</span>
          <span className="dim"> — break work into visible task lists</span>
        </label>
        <label className="model-picker-toggle">
          <input
            type="checkbox"
            checked={autoAccept}
            onChange={(e) => onAutoAcceptChange(e.target.checked)}
          />
          <span>Auto-accept edits</span>
          <span className="dim"> — skip permission prompts for file writes and shell commands</span>
        </label>
      </div>
    </div>
  );
}
