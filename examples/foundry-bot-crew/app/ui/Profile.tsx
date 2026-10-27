"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { postJson } from "./api";

const MAX_STYLE = 200;

/** Name, job and working style. Saving writes the bot's instance; its next run reads them. */
export function ProfileForm(props: { readonly botId: string; readonly name: string; readonly job: string; readonly style: string }) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [job, setJob] = useState(props.job);
  const [style, setStyle] = useState(props.style);
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const changed = name !== props.name || job !== props.job || style !== props.style;

  async function save(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, note: null });
    try {
      await postJson(`/api/bots/${encodeURIComponent(props.botId)}`, { name, job, style }, "PATCH");
      setState({ busy: false, note: "Saved." });
      router.refresh();
    } catch (error) {
      setState({ busy: false, note: error instanceof Error ? error.message : "That didn't save." });
    }
  }

  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="field">
        <label htmlFor="bot-name">Name</label>
        <input id="bot-name" className="input" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="bot-job">Job</label>
        <textarea id="bot-job" className="input" rows={2} value={job} maxLength={300} onChange={(event) => setJob(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="bot-style">Working style</label>
        <textarea id="bot-style" className="input" rows={2} value={style} maxLength={MAX_STYLE} onChange={(event) => setStyle(event.target.value)} />
        <span className="muted" style={{ fontSize: 13 }}>{style.length} of {MAX_STYLE} characters</span>
      </div>
      {changed || state.note ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {changed ? <button type="submit" className="button primary" disabled={state.busy}>Save</button> : null}
          {state.note ? <span role="status" className="muted" style={{ fontSize: 14 }}>{state.note}</span> : null}
        </div>
      ) : null}
    </form>
  );
}

/** Star, duplicate, save as template. */
export function BotActions({ botId, starred }: { readonly botId: string; readonly starred: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const base = `/api/bots/${encodeURIComponent(botId)}`;

  async function act(what: string, run: () => Promise<void>) {
    setBusy(what);
    setNote(null);
    try {
      await run();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {starred ? null : (
          <button type="button" className="button" disabled={busy !== null} onClick={() => act("star", async () => { await postJson(`${base}/star`, {}); router.refresh(); })}>
            Make Primary Bot
          </button>
        )}
        <button type="button" className="button" disabled={busy !== null} onClick={() => act("copy", async () => {
          const { id } = await postJson<{ id: string }>(`${base}/duplicate`, {});
          router.push(`/bots/${id}/profile`);
        })}>
          Duplicate
        </button>
        <button type="button" className="button" disabled={busy !== null} onClick={() => act("template", async () => {
          const { name } = await postJson<{ name: string }>(`${base}/template`, {});
          setNote(`Saved "${name}" to your templates.`);
        })}>
          Save as template
        </button>
      </div>
      {note ? <span role="status" className="muted" style={{ fontSize: 13 }}>{note}</span> : null}
    </div>
  );
}
