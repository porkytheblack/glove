"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApprovalCard, Composer, Thread, useLiveRun, type ApprovalDecision, type DisplayMessage } from "glove-foundry-web-kit/client";
import type { ChatState } from "../server/dot";
import { getJson, postJson } from "./api";

export interface About {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly owner: string;
  readonly responsibilities: ReadonlyArray<{ readonly job: string; readonly sources: ReadonlyArray<string>; readonly attention: string; readonly mustNot: string }>;
  readonly where: string;
  readonly routing: string;
}

const DISMISSED = (dotId: string) => `dot:not-yet:${dotId}`;

function readDismissed(dotId: string): string | null {
  try {
    return window.localStorage.getItem(DISMISSED(dotId));
  } catch {
    return null;
  }
}

/** The dot's home: who it is and what it holds, its latest suggestion, and the app conversation. */
export function Home({ about, initial }: { readonly about: About; readonly initial: ChatState }) {
  const [state, setState] = useState(initial);
  const [sent, setSent] = useState<DisplayMessage[]>([]);
  const [stopped, setStopped] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const url = `/api/dots/${encodeURIComponent(about.id)}/chat`;

  useEffect(() => setDismissed(readDismissed(about.id)), [about.id]);

  const refresh = useCallback(async () => {
    const next = await getJson<ChatState>(url);
    setState(next);
    setSent([]);
  }, [url]);

  const live = useLiveRun(state.runId, {
    // The messages so far are streaming in; only the approval card is new.
    onApproval: () => void getJson<ChatState>(url).then((next) => setState((current) => ({ ...current, approvals: next.approvals }))),
    onEnd: (status) => {
      setStopped(status !== "completed");
      void refresh();
    },
  });
  const replying = Boolean(state.runId) && live.status === "running";

  // Between replies, check now and then for work that started on its own: research, new mail, a follow-up.
  useEffect(() => {
    if (replying) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void getJson<ChatState>(url).then((next) => {
        setState((current) => next.total !== current.total || next.runId !== current.runId || next.approvals.length !== current.approvals.length
          || next.status.text !== current.status.text || next.suggestion !== current.suggestion ? next : current);
      }).catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [replying, url]);

  async function send(text: string) {
    setStopped(false);
    setSent((current) => [...current, { id: `sent-${Date.now()}`, sender: "person", text }]);
    try {
      const { runId } = await postJson<{ runId: string }>(url, { text });
      setState((current) => ({ ...current, runId, suggestion: null, status: current.status.kind === "paused" ? current.status : { kind: "working", text: "Working" } }));
    } catch (error) {
      setSent((current) => current.slice(0, -1));
      throw error;
    }
  }

  async function decide(approvalId: string, decision: ApprovalDecision) {
    await postJson(`/api/approvals/${encodeURIComponent(approvalId)}`, { decision });
    setState((current) => ({ ...current, approvals: current.approvals.filter((item) => item.id !== approvalId) }));
    if (!replying) await refresh();
  }

  function notYet(suggestion: string) {
    setDismissed(suggestion);
    try {
      window.localStorage.setItem(DISMISSED(about.id), suggestion);
    } catch {
      // Hidden for now, then.
    }
  }

  const suggestion = state.suggestion && state.suggestion !== dismissed ? state.suggestion : null;

  return (
    <div className="home">
      <aside aria-label={`About ${about.name}`} className="about">
        <div className="who">
          <span aria-hidden="true" className="orb" />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <h1>{about.name}</h1>
            <span className="handle">{about.handle} · {about.owner}&apos;s dot</span>
          </div>
        </div>
        <span className={`status ${state.status.kind}`} role="status"><span aria-hidden="true" className="dot" />{state.status.text}</span>

        <section aria-labelledby="responsibilities" className="stack">
          <h2 id="responsibilities">Responsibilities</h2>
          <ul className="resp-list">
            {about.responsibilities.map((item, index) => (
              <li key={`${index}-${item.job}`} className="resp">
                <span className="resp-job">{item.job}</span>
                <span className="resp-meta">{item.sources.join(", ")}{item.mustNot ? ` · ${lower(item.mustNot)}` : ""}</span>
                {item.attention ? <span className="resp-meta">Tells you about: {lower(item.attention)}</span> : null}
              </li>
            ))}
          </ul>
          <HandResponsibility dotId={about.id} name={about.name} />
        </section>

        <section aria-labelledby="where" className="stack tight">
          <h2 id="where">Where {about.name} is</h2>
          <p className="muted small">{about.where}</p>
          <p className="muted small">{about.routing}</p>
        </section>
      </aside>

      <section aria-label={`Talk to ${about.name}`} className="talk">
        {suggestion ? (
          <div className="talk-top">
            <div role="group" aria-label="Suggestion from research" className="suggestion">
              <span className="suggestion-label">FROM RESEARCH</span>
              <span className="suggestion-text">{suggestion}</span>
              <div className="buttons">
                <button type="button" className="button primary" disabled={replying} onClick={() => void send(`Go ahead: ${suggestion}`).catch(() => undefined)}>Go ahead</button>
                <button type="button" className="button" onClick={() => notYet(suggestion)}>Not yet</button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="talk-scroll">
          <div className="talk-body">
            <Thread
              messages={[...state.messages, ...sent]}
              live={live.messages}
              empty={<p className="muted" style={{ margin: 0, fontSize: 15 }}>Say hello to {about.name}. It researches what it holds every couple of hours and brings you what matters.</p>}
            >
              {state.approvals.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} labels={{ approve: "Approve" }} onDecide={(decision) => decide(approval.id, decision)} />
              ))}
              {stopped ? <p role="status" className="muted" style={{ margin: 0, fontSize: 14 }}>That reply stopped before it finished. Try again.</p> : null}
            </Thread>
          </div>
        </div>
        <div className="talk-foot">
          <Composer label={`Message ${about.name}`} placeholder={`Message ${about.name}`} disabled={replying} onSend={send} />
        </div>
      </section>
    </div>
  );
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, "");

/** "Hand Pip a responsibility": a write to the dot's data. Its next research run covers it. */
function HandResponsibility({ dotId, name }: { readonly dotId: string; readonly name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/dots/${encodeURIComponent(dotId)}/responsibilities`, Object.fromEntries(form));
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Hand {name} a responsibility</button>;
  return (
    <form onSubmit={submit} className="resp-form" aria-label={`Hand ${name} a responsibility`}>
      <div className="field">
        <label htmlFor="resp-job">What should {name} look after?</label>
        <input id="resp-job" name="job" className="input" required maxLength={300} placeholder="Chase unpaid invoices" />
      </div>
      <div className="field">
        <label htmlFor="resp-sources">Where it looks, separated by commas</label>
        <input id="resp-sources" name="sources" className="input" required maxLength={300} placeholder="support inbox, #billing" />
      </div>
      <div className="field">
        <label htmlFor="resp-attention">What it should tell you about</label>
        <input id="resp-attention" name="attention" className="input" maxLength={300} placeholder="Anything over 30 days late" />
      </div>
      <div className="field">
        <label htmlFor="resp-must-not">What it must not do yet</label>
        <input id="resp-must-not" name="mustNot" className="input" maxLength={300} placeholder="Never threaten late fees" />
      </div>
      {error ? <span role="alert" className="error">{error}</span> : null}
      <div className="buttons">
        <button type="submit" className="button primary" disabled={busy}>Hand it over</button>
        <button type="button" className="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
