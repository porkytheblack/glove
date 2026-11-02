"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { postJson } from "./api";

interface Bot {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
}

/** Name the chat and pick its bots. */
export function NewGroup({ bots }: { readonly bots: ReadonlyArray<Bot> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await postJson<{ id: string }>("/api/groups", { name, members: picked });
      router.push(`/groups/${id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work.");
      setBusy(false);
    }
  }

  if (bots.length < 2) return <p className="muted" style={{ margin: 0, fontSize: 15 }}>A group chat needs two bots with a job. Make another one first.</p>;
  return (
    <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 480 }}>
      <div className="field">
        <label htmlFor="group-name">Name</label>
        <input id="group-name" className="input" value={name} maxLength={60} placeholder="Launch week" onChange={(event) => setName(event.target.value)} />
      </div>
      <fieldset style={{ margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 2 }}>
        <legend className="label" style={{ marginBottom: 8 }}>BOTS · {picked.length} OF 6</legend>
        {bots.map((bot) => (
          <label key={bot.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, minHeight: 44, fontSize: 15, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={picked.includes(bot.id)}
              disabled={!picked.includes(bot.id) && picked.length >= 6}
              onChange={(event) => setPicked((current) => event.target.checked ? [...current, bot.id] : current.filter((id) => id !== bot.id))}
            />
            <span aria-hidden="true" className="avatar" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 12 }}>{bot.initials}</span>
            {bot.name}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="button primary" style={{ alignSelf: "flex-start" }} disabled={busy || !name.trim() || picked.length < 2}>Start the chat</button>
      {error ? <span role="alert" style={{ fontSize: 13, color: "var(--kit-ask)" }}>{error}</span> : null}
    </form>
  );
}
