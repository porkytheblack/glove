"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ApprovalDecision, ApprovalView } from "glove-foundry-web-kit/client";
import type { ActivityState, HandOffLine, RunLine } from "../server/dot";
import { getJson, postJson } from "./api";
import { actionLabel, ago } from "./labels";

const NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Activity: what the dot is doing, what waits on the person, its follow-ups and files, and pause. */
export function Activity({ dot, pauseAfter, initial }: {
  readonly dot: { readonly id: string; readonly name: string };
  readonly pauseAfter: number;
  readonly initial: ActivityState;
}) {
  const [state, setState] = useState(initial);
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/dots/${encodeURIComponent(dot.id)}/activity`;

  const refresh = useCallback(async () => setState(await getJson<ActivityState>(url)), [url]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, 4_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function togglePause() {
    setPausing(true);
    setError(null);
    try {
      await postJson(`/api/dots/${encodeURIComponent(dot.id)}/pause`, { paused: !state.paused });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't go through. Try again.");
    } finally {
      setPausing(false);
    }
  }

  const waiting = state.approvals.length + state.handOffs.length;
  return (
    <>
      <div className="page-head">
        <div className="intro">
          <h1>Activity</h1>
          <p>What {dot.name} is doing, what waits on you, and what it made. A paused {dot.name} only reads. Pausing doesn&apos;t undo what&apos;s done.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button type="button" className={`button strong${state.paused ? " primary" : ""}`} disabled={pausing} onClick={() => void togglePause()}>
            {state.paused ? `Resume ${dot.name}` : `Pause ${dot.name}`}
          </button>
          {error ? <span role="alert" className="error">{error}</span> : null}
        </div>
      </div>
      {state.paused ? (
        <p className="notice" role="status">{dot.name} is paused. Its runs only read until you resume it: no email, posts, pull requests or work on its computer.</p>
      ) : null}

      <div className="board">
        <section aria-labelledby="now" className="panel">
          <h2 id="now">In progress</h2>
          {state.runs.length === 0 ? (
            <p className="muted small">
              Nothing right now.{state.status.kind === "ready" && state.status.text.includes(" · ") ? ` It ${state.status.text.split(" · ")[1]}.` : ""}
            </p>
          ) : null}
          {state.runs.map((run) => <InProgress key={run.id} run={run} dotName={dot.name} onRedirected={refresh} />)}
        </section>

        <section aria-labelledby="waiting" className="panel">
          <h2 id="waiting">Waiting on you</h2>
          {waiting === 0 ? <p className="muted small">Nothing waits on you.</p> : null}
          {state.approvals.map((approval) => <AskFirst key={approval.id} approval={approval} onDecided={refresh} />)}
          {state.handOffs.map((handOff) => <YoursToDo key={handOff.id} handOff={handOff} dotName={dot.name} onDone={refresh} />)}
        </section>

        <section aria-labelledby="follow" className="panel">
          <h2 id="follow">Follow-ups</h2>
          {state.followUps.length === 0 ? <p className="muted small">None yet. Ask {dot.name} to follow up, or to do something on a schedule.</p> : (
            <ul className="lines">
              {state.followUps.map((item) => (
                <li key={item.id}>
                  <span>{item.what}</span>
                  <span className="muted small">{item.when} · {item.acts ? "acts under your rules" : "read only"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="files" className="panel">
          <h2 id="files">Files</h2>
          {state.files.length === 0 ? <p className="muted small">Nothing on {dot.name}&apos;s computer yet.</p> : (
            <ul className="files">
              {state.files.map((file) => (
                <li key={`${file.agentId}:${file.path}`}>
                  <a href={`/api/files?agent=${encodeURIComponent(file.agentId)}&path=${encodeURIComponent(file.path)}`} target="_blank" rel="noreferrer">
                    {file.path.split("/").at(-1)}
                  </a>
                  <span className="muted small">{file.agentId === dot.id ? `${dot.name}'s computer` : `${file.owner}'s computer`} · {file.path}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="muted small" style={{ margin: 0 }}>A monitor pauses {dot.name} on its own after {NUMBERS[pauseAfter] ?? pauseAfter} hand-offs or denials in a row.</p>
    </>
  );
}

function InProgress({ run, dotName, onRedirected }: { readonly run: RunLine; readonly dotName: string; readonly onRedirected: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builder = run.who !== dotName;

  async function redirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("text") ?? "").trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/runs/${encodeURIComponent(run.id)}/steer`, { text });
      setOpen(false);
      await onRedirected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="item" data-run={run.id}>
      <div className="item-row">
        <span>{builder ? `${run.who}: ${run.what}` : run.what}</span>
        <span className="muted">{builder ? "on its computer" : run.readOnly ? "read only" : "under your rules"} · {ago(run.startedAt)}</span>
      </div>
      {open ? (
        <form onSubmit={redirect} className="redirect">
          <label htmlFor={`redirect-${run.id}`} className="muted small">Tell {builder ? "the builder" : dotName} what to do instead. This run stops and starts again from your message.</label>
          <div className="buttons">
            <input id={`redirect-${run.id}`} name="text" className="input grow" required maxLength={4000} autoFocus />
            <button type="submit" className="button primary" disabled={busy}>Redirect</button>
            <button type="button" className="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {error ? <span role="alert" className="error">{error}</span> : null}
        </form>
      ) : (
        <button type="button" className="button small" onClick={() => setOpen(true)}>Redirect</button>
      )}
    </div>
  );
}

function AskFirst({ approval, onDecided }: { readonly approval: ApprovalView; readonly onDecided: () => Promise<void> }) {
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fields = approval.fields.filter((field) => field.label !== "Why");
  const why = approval.fields.find((field) => field.label === "Why")?.value;

  async function decide(decision: ApprovalDecision) {
    setBusy(decision);
    setError(null);
    try {
      await postJson(`/api/approvals/${encodeURIComponent(approval.id)}`, { decision });
      await onDecided();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't go through. Try again.");
      setBusy(null);
    }
  }

  return (
    <div role="group" aria-label="Ask first" className="ask" data-approval={approval.id}>
      <div className="item-row"><span className="tag ask-tag">ASK FIRST</span><span className="muted small">{ago(approval.requestedAt)}</span></div>
      <span className="item-title">{approval.title}</span>
      {fields.length > 0 ? (
        <dl className="fields">
          {fields.map((field) => [
            <dt key={`${field.label}-dt`}>{field.label}</dt>,
            <dd key={`${field.label}-dd`}>{field.value}</dd>,
          ])}
        </dl>
      ) : null}
      {approval.body ? <p className="body">{approval.body}</p> : null}
      {why ? <span className="muted small">{why}</span> : null}
      <div className="buttons">
        <button type="button" className="button primary" disabled={busy !== null} onClick={() => void decide("approve")}>Approve</button>
        <button type="button" className="button" disabled={busy !== null} onClick={() => void decide("deny")}>Deny</button>
      </div>
      {error ? <span role="alert" className="error">{error}</span> : null}
    </div>
  );
}

function YoursToDo({ handOff, dotName, onDone }: { readonly handOff: HandOffLine; readonly dotName: string; readonly onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function done() {
    setBusy(true);
    try {
      await postJson(`/api/handoffs/${encodeURIComponent(handOff.id)}`, {});
      await onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="group" aria-label="Yours to do" className="yours" data-handoff={handOff.id}>
      <div className="item-row"><span className="tag">YOURS TO DO</span><span className="muted small">{ago(handOff.at)}</span></div>
      <span className="item-title">{handOff.todo}</span>
      <span className="muted small">
        {handOff.builtIn
          ? `Built-in safety: "${actionLabel(handOff.action).toLowerCase()}" is always yours, so ${dotName} handed it to you.`
          : `Your rule hands "${actionLabel(handOff.action).toLowerCase()}" to you, so ${dotName} didn't do it.`}
      </span>
      <button type="button" className="button small" disabled={busy} onClick={() => void done()}>Mark done</button>
    </div>
  );
}
