"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApprovalCard, Composer, Thread, useLiveRun, type ApprovalDecision, type DisplayMessage } from "glove-foundry-web-kit/client";
import type { ChatState, MuseApproval } from "../server/muse";
import { getJson, postJson } from "./api";
import { avatarColor } from "./look";
import { SentinelCard } from "./SentinelCard";

const CHAT = "/api/chat";

const LABELS: Record<string, { readonly approve: string; readonly deny: string }> = {
  buy: { approve: "Pay", deny: "Don't buy" },
};

/** The app conversation with Muse: the reply streaming in, its questions inline, and the composer. */
export function Chat({ name, avatar, initial }: { readonly name: string; readonly avatar: string; readonly initial: ChatState }) {
  const [state, setState] = useState(initial);
  const [sent, setSent] = useState<DisplayMessage[]>([]);
  const [stopped, setStopped] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getJson<ChatState>(CHAT);
    setState(next);
    setSent([]);
  }, []);

  const live = useLiveRun(state.runId, {
    // The messages so far are streaming in; only the card is new.
    onApproval: () => void getJson<ChatState>(CHAT).then((next) => setState((current) => ({ ...current, approvals: next.approvals, status: next.status }))),
    onEnd: (status) => {
      setStopped(status !== "completed");
      void refresh();
    },
  });
  const replying = Boolean(state.runId) && live.status === "running";

  // Between replies, look now and then for work that started elsewhere: WhatsApp, new mail, its own checks.
  useEffect(() => {
    if (replying) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void getJson<ChatState>(CHAT).then((next) => {
        setState((current) => next.total !== current.total || next.runId !== current.runId || next.approvals.length !== current.approvals.length
          || next.status !== current.status || Boolean(next.handOff) !== Boolean(current.handOff) ? next : current);
      }).catch(() => undefined);
    }, 4_000);
    return () => clearInterval(timer);
  }, [replying]);

  async function send(text: string) {
    setStopped(false);
    setSent((current) => [...current, { id: `sent-${Date.now()}`, sender: "person", text }]);
    try {
      const { runId } = await postJson<{ runId: string }>(CHAT, { text });
      setState((current) => ({ ...current, runId, status: "Working on it" }));
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

  const card = (approval: MuseApproval) => approval.sentinel
    ? <SentinelCard key={approval.id} approval={{ ...approval, sentinel: approval.sentinel }} name={name} onDecide={(decision) => decide(approval.id, decision)} />
    : (
      <ApprovalCard
        key={approval.id}
        approval={approval.onWhatsApp ? { ...approval, title: `${approval.title} (asked on WhatsApp)` } : approval}
        labels={LABELS[approval.toolName] ?? { approve: "Yes, go ahead", deny: "Not now" }}
        onDecide={(decision) => decide(approval.id, decision)}
      />
    );

  return (
    <>
      <header className="head row">
        <span aria-hidden="true" className="avatar" style={{ background: avatarColor(avatar) }}>{name.charAt(0).toUpperCase()}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <h1>{name}</h1>
          <span className="sub" role="status">{replying ? "Working on it" : state.status}</span>
        </div>
      </header>
      <main className="main thread" aria-label={`Chat with ${name}`}>
        {state.whatsapp ? <span className="also">Also on WhatsApp, with the same memory</span> : null}
        <Thread
          messages={[...state.messages, ...sent]}
          live={live.messages}
          style={{ gap: 12 }}
          empty={<p className="muted" style={{ margin: 0, fontSize: 15 }}>Say hello to {name}. Ask it to book, buy, plan or remember something.</p>}
        >
          {state.approvals.map(card)}
          {state.handOff ? (
            <div className="bubble">
              <span>{state.handOff.site} wants you signed in. You do that part yourself; I never see your password.</span>
              <Link href="/watch" className="button">Open the sign-in</Link>
            </div>
          ) : null}
          {stopped ? <p role="status" className="status" style={{ margin: 0 }}>That reply stopped before it finished. Try again.</p> : null}
        </Thread>
      </main>
      <div className="composer">
        <Composer label={`Message ${name}`} placeholder={`Message ${name}`} disabled={replying} onSend={send} />
      </div>
    </>
  );
}
