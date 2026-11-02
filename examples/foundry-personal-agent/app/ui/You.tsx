"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { request, postJson } from "./api";
import { AVATARS, type AvatarKey } from "./look";

/**
 * Name, look and how it talks. Each change is saved as it is made (a colour
 * on tap, the text when you leave the box): a write to the instance, which
 * its next run reads.
 */
export function PersonaForm(props: { readonly name: string; readonly avatar: string; readonly style: string }) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [avatar, setAvatar] = useState(props.avatar);
  const [style, setStyle] = useState(props.style);
  const [saved, setSaved] = useState({ name: props.name, avatar: props.avatar, style: props.style });
  const [note, setNote] = useState<string | null>(null);

  async function save(next: { name: string; avatar: string; style: string }) {
    if (next.name === saved.name && next.avatar === saved.avatar && next.style === saved.style) return;
    if (!next.name.trim()) {
      setNote("Give it a name.");
      return;
    }
    setNote("Saving…");
    try {
      await postJson("/api/persona", next, "PATCH");
      setSaved(next);
      setNote("Saved.");
      router.refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That didn't save.");
    }
  }

  return (
    <section aria-labelledby="look" className="card" style={{ gap: 12 }}>
      <h2 id="look">Name and look</h2>
      <div role="group" aria-label="Avatar" className="swatches">
        {AVATARS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={avatar === item.key}
            aria-label={item.label}
            className="swatch"
            style={{ background: item.color }}
            onClick={() => {
              setAvatar(item.key as AvatarKey);
              void save({ name, avatar: item.key, style });
            }}
          />
        ))}
      </div>
      <div className="field">
        <label htmlFor="agent-name">Name</label>
        <input
          id="agent-name"
          className="input"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void save({ name: name.trim(), avatar, style })}
          onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="field">
        <label htmlFor="agent-style">How it talks</label>
        <textarea
          id="agent-style"
          className="input"
          rows={2}
          value={style}
          maxLength={200}
          onChange={(event) => setStyle(event.target.value)}
          onBlur={() => void save({ name, avatar, style: style.trim() })}
        />
      </div>
      {note ? <span role="status" className="status">{note}</span> : null}
    </section>
  );
}

/** What it remembers, each with Forget: the same removal as asking it to forget. */
export function MemoryList({ name, memories }: { readonly name: string; readonly memories: ReadonlyArray<{ readonly id: string; readonly text: string }> }) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = memories.filter((memory) => !gone.includes(memory.id));

  async function forget(id: string) {
    setBusy(id);
    setError(null);
    try {
      await request(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
      setGone((current) => [...current, id]);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="remembers" className="card" style={{ gap: 8 }}>
      <h2 id="remembers">What it remembers</h2>
      {shown.length === 0 ? <span className="note">Nothing yet. Tell {name} something to remember, here or on WhatsApp.</span> : (
        <ul className="list rows">
          {shown.map((memory) => (
            <li key={memory.id}>
              <span>{memory.text}</span>
              <button type="button" className="button small" disabled={busy !== null} onClick={() => forget(memory.id)} aria-label={`Forget: ${memory.text}`}>Forget</button>
            </li>
          ))}
        </ul>
      )}
      {error ? <span role="alert" className="status">{error}</span> : null}
    </section>
  );
}
