"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApprovalCard, Composer, Thread, useLiveRun, type ApprovalDecision, type DisplayMessage } from "glove-foundry-web-kit/client";
import type { ChatState } from "../server/chat";
import { getJson, postJson } from "./api";

interface Bot {
  readonly id: string;
  readonly name: string;
  readonly starred: boolean;
  readonly job?: string;
}

/** A bot's chat: the conversation, the reply streaming in, approvals inline, and the composer. */
export function Chat({ bot, initial, draft }: { readonly bot: Bot; readonly initial: ChatState; readonly draft?: string }) {
  const [state, setState] = useState(initial);
  const [sent, setSent] = useState<DisplayMessage[]>([]);
  const [stopped, setStopped] = useState(false);
  const url = `/api/bots/${encodeURIComponent(bot.id)}/chat`;

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

  // Between replies, check now and then for work that started elsewhere: new mail, a routine.
  useEffect(() => {
    if (replying) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void getJson<ChatState>(url).then((next) => {
        setState((current) => next.total !== current.total || next.runId !== current.runId || next.approvals.length !== current.approvals.length ? next : current);
      }).catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [replying, url]);

  async function send(text: string) {
    setStopped(false);
    setSent((current) => [...current, { id: `sent-${Date.now()}`, sender: "person", text }]);
    try {
      const { runId } = await postJson<{ runId: string }>(url, { text });
      setState((current) => ({ ...current, runId }));
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

  return (
    <section aria-label={`Chat with ${bot.name}`} className="chat">
      <div className="chat-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1>{bot.name}{bot.starred ? <span className="pill">Primary Bot</span> : null}</h1>
          <span className="sub">
            {bot.job ?? "No job yet. Tell it what you want it around for."}
            {bot.starred ? " · asks that name no bot come here" : ""}
          </span>
        </div>
        <Link href={`/bots/${bot.id}/profile`}>Profile</Link>
      </div>
      <div className="chat-scroll">
        <div className="chat-body">
          <Thread
            messages={[...state.messages, ...sent]}
            live={live.messages}
            empty={<p className="muted" style={{ margin: 0, fontSize: 15 }}>{bot.job ? `Say hello to ${bot.name}.` : "Tell this bot what you want it around for. It names itself for the job."}</p>}
          >
            {state.approvals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onDecide={(decision) => decide(approval.id, decision)} />
            ))}
            {stopped ? <p role="status" className="muted" style={{ margin: 0, fontSize: 14 }}>That reply stopped before it finished. Try again.</p> : null}
          </Thread>
        </div>
      </div>
      <div className="chat-foot">
        <Composer
          label={`Message ${bot.name}`}
          placeholder={`Message ${bot.name}. / runs a skill`}
          disabled={replying}
          onSend={send}
          {...(draft ? { defaultValue: draft } : {})}
        />
      </div>
    </section>
  );
}
