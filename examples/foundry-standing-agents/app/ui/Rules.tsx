"use client";

import { useState } from "react";
import { postJson } from "./api";
import { actionLabel } from "./labels";

type Level = "allow" | "when_asked" | "ask" | "block";

/** Custom Rules: one setting per action, written to the dot's data. Built-in safety is shown, locked. */
export function Rules({ dot, levels, rules, safety }: {
  readonly dot: { readonly id: string; readonly name: string };
  readonly levels: ReadonlyArray<{ readonly level: Level; readonly label: string }>;
  readonly rules: ReadonlyArray<{ readonly action: string; readonly level: Level }>;
  readonly safety: ReadonlyArray<{ readonly action: string; readonly label: string }>;
}) {
  const [current, setCurrent] = useState<Record<string, Level>>(() => Object.fromEntries(rules.map((rule) => [rule.action, rule.level])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ action: string; message: string } | null>(null);

  async function set(action: string, level: Level) {
    if (busy || current[action] === level) return;
    const before = current[action]!;
    setBusy(action);
    setError(null);
    setCurrent((rules) => ({ ...rules, [action]: level }));
    try {
      await postJson(`/api/dots/${encodeURIComponent(dot.id)}/rules`, { action, level }, "PUT");
    } catch (cause) {
      setCurrent((rules) => ({ ...rules, [action]: before }));
      setError({ action, message: cause instanceof Error ? cause.message : "That didn't save. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="intro">
        <h1>Custom Rules</h1>
        <p>For each action, say what {dot.name} does. An auto-review checks sensitive actions against these rules before they run; it can&apos;t be switched off.</p>
      </div>

      <section aria-labelledby="yours" className="table">
        <h2 id="yours" className="table-head">Your rules</h2>
        {rules.map(({ action }) => (
          <div key={action} className="rule" data-rule={action}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span>{actionLabel(action)}</span>
              {action === "send_email" ? <span className="muted small">Email to someone who never wrote in still asks first, unless this hands it to you.</span> : null}
              {error?.action === action ? <span role="alert" className="error">{error.message}</span> : null}
            </div>
            <div role="group" aria-label={actionLabel(action)} className="segments">
              {levels.map(({ level, label }) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={current[action] === level}
                  disabled={busy === action}
                  onClick={() => void set(action, level)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="builtin" className="table">
        <div className="table-head plain">
          <h2 id="builtin">Built-in safety</h2>
          <span className="muted small">These hold whatever your rules say.</span>
        </div>
        <ul className="safety">
          {safety.map((item) => (
            <li key={item.action} data-safety={item.action}>
              <span>{actionLabel(item.action)}</span>
              <span className="locked">{item.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
