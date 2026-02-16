import { useState, useEffect, useRef, useCallback } from "react";

/* -------------------------------------------------------------------------- */
/*  ModelSwitcher                                                              */
/*                                                                            */
/*  A compact popover that opens from the header model badge, letting the     */
/*  user change the provider/model mid-session. Disabled while the agent is   */
/*  busy.                                                                      */
/*                                                                            */
/*  Design decisions:                                                          */
/*  - Popover anchored to the badge, not a modal -- maintains spatial context */
/*  - Only shows provider + model dropdowns (features are session-level,      */
/*    changing them mid-session would be confusing)                            */
/*  - "Apply" button instead of auto-apply -- prevents accidental switches    */
/*  - Escape or click-outside dismisses without applying                      */
/* -------------------------------------------------------------------------- */

interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  models: string[];
  defaultModel: string;
}

interface Props {
  serverHttpUrl: string;
  currentModel: string;
  busy: boolean;
  onChangeModel: (provider: string, model?: string) => void;
}

export function ModelSwitcher({ serverHttpUrl, currentModel, busy, onChangeModel }: Props) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Fetch providers when the popover opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${serverHttpUrl}/providers`)
      .then((r) => r.json())
      .then((data: ProviderInfo[]) => {
        setProviders(data);
        setLoading(false);
        // Try to detect the current provider from the model name
        // Model name format is "provider:model" or just "model"
        if (currentModel) {
          const colonIdx = currentModel.indexOf(":");
          if (colonIdx > 0) {
            const provId = currentModel.slice(0, colonIdx);
            const modelId = currentModel.slice(colonIdx + 1);
            const match = data.find((p) => p.id === provId);
            if (match) {
              setSelectedProvider(provId);
              setSelectedModel(modelId);
              return;
            }
          }
          // Fallback: find a provider whose models include the current model
          for (const p of data) {
            if (p.models.includes(currentModel) || p.defaultModel === currentModel) {
              setSelectedProvider(p.id);
              setSelectedModel(currentModel);
              return;
            }
          }
        }
      })
      .catch(() => setLoading(false));
  }, [open, serverHttpUrl, currentModel]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleApply = useCallback(() => {
    if (!selectedProvider) return;
    onChangeModel(selectedProvider, selectedModel || undefined);
    setOpen(false);
  }, [selectedProvider, selectedModel, onChangeModel]);

  const providerInfo = providers.find((p) => p.id === selectedProvider);
  const models = providerInfo?.models ?? [];

  // Short display label for the badge
  const displayLabel = currentModel ? currentModel.replace(/^[^:]+:/, "") : "No model";

  return (
    <div className="model-switcher-anchor">
      <button
        ref={triggerRef}
        className={`header-model header-model-interactive${busy ? " header-model-disabled" : ""}${open ? " header-model-active" : ""}`}
        onClick={() => {
          if (!busy) setOpen(!open);
        }}
        disabled={busy}
        title={busy ? "Cannot change model while busy" : `Model: ${currentModel || "default"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {displayLabel}
        <svg
          className="header-model-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.5 4L5 6.5L7.5 4" />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="model-switcher-popover"
          role="dialog"
          aria-label="Change model"
        >
          <div className="model-switcher-header">
            <span className="model-switcher-title">Switch model</span>
          </div>

          {loading ? (
            <div className="model-switcher-loading">
              <span className="spinner small" /> Loading providers...
            </div>
          ) : (
            <div className="model-switcher-body">
              <div className="model-switcher-field">
                <label className="model-switcher-label" htmlFor="ms-provider">
                  Provider
                </label>
                <select
                  id="ms-provider"
                  className="model-picker-select"
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value);
                    setSelectedModel("");
                  }}
                >
                  <option value="" disabled>
                    Select provider...
                  </option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.name}
                      {!p.available ? " (no API key)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {selectedProvider && models.length > 0 && (
                <div className="model-switcher-field">
                  <label className="model-switcher-label" htmlFor="ms-model">
                    Model
                  </label>
                  <select
                    id="ms-model"
                    className="model-picker-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    <option value="">
                      Default ({providerInfo?.defaultModel})
                    </option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="model-switcher-actions">
                <button
                  className="btn model-switcher-cancel"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-allow model-switcher-apply"
                  onClick={handleApply}
                  disabled={!selectedProvider}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
