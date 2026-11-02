"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./api";

type Access = "read" | "act";

const WHAT: Record<string, Record<Access, string>> = {
  gmail: { read: "Reads your mail. Can't send any.", act: "Reads your mail. Sends only after you say yes to each email." },
  calendar: { read: "Sees your calendar. Changes nothing.", act: "Sees your calendar. Asks before it changes anything." },
};

/** Read or Act for one app, or disconnect it. Each is a write to Muse's installation, not a deploy. */
export function AccessControl({ app, name, account, access }: {
  readonly app: string;
  readonly name: string;
  readonly account: string | null;
  readonly access: Access | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(access);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: Access | "off") {
    if (busy || next === current) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/apps/${app}`, { access: next }, "PUT");
      setCurrent(next === "off" ? null : next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="app-head">
        <div>
          <h2 id={`c-${app}`}>{name}</h2>
          <span>{account ?? "Not connected"}</span>
        </div>
        {account && current ? <button type="button" className="linkish" style={{ padding: "0 4px", fontSize: 13 }} disabled={busy} onClick={() => set("off")}>Disconnect</button> : null}
      </div>
      {account ? (
        <>
          <div role="group" aria-label={`${name} access`} className="segmented">
            {(["read", "act"] as const).map((level) => (
              <button key={level} type="button" aria-pressed={current === level} disabled={busy} onClick={() => set(level)}>
                {level === "read" ? "Read" : "Act"}
              </button>
            ))}
          </div>
          <span className="note">{current ? WHAT[app]?.[current] : "Off: it can't use this app. Pick Read or Act to give it back."}</span>
        </>
      ) : (
        <span className="note">Not connected yet. Once it is, choose here what it may do.</span>
      )}
      {error ? <span role="alert" className="status">{error}</span> : null}
    </>
  );
}
