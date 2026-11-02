"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./api";

/** Makes a bot (blank or from a template) and opens its chat. */
export function NewBot({ request, label, primary = false }: { readonly request: Record<string, unknown>; readonly label: string; readonly primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "flex-start" }}>
      <button
        type="button"
        className={primary ? "button primary" : "button"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { id } = await postJson<{ id: string }>("/api/bots", request);
            router.push(`/bots/${id}`);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That didn't work.");
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {error ? <span role="alert" style={{ fontSize: 13, color: "var(--kit-ask)" }}>{error}</span> : null}
    </div>
  );
}
