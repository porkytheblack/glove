"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApprovalCard, Composer, Thread, Turn, avatarStyle, useLiveRun, type ApprovalDecision, type DisplayMessage } from "glove-foundry-web-kit/client";
import type { GroupState, Member } from "../server/group";
import { getJson, postJson } from "./api";

/** "@Sales Outbound" and "@everyone" in the accent colour. */
function mentions(names: ReadonlyArray<string>): (text: string) => ReactNode {
  const escaped = [...names, "everyone"].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(@(?:${escaped.join("|")}))`, "gi");
  return (text) => text.split(pattern).map((part, index) => index % 2 === 1 ? <span key={index} className="mention">{part}</span> : <Fragment key={index}>{part}</Fragment>);
}

/** One member's answer as it streams in. */
function LiveReply({ runId, member, onEnd, onApproval, renderText }: {
  readonly runId: string;
  readonly member?: Member;
  readonly onEnd: () => void;
  readonly onApproval: () => void;
  readonly renderText: (text: string) => ReactNode;
}) {
  const live = useLiveRun(runId, { onEnd, onApproval });
  if (live.messages.length === 0) return null;
  return <Turn messages={live.messages} renderText={renderText} {...(member ? { author: { name: member.name, initials: member.initials } } : {})} />;
}

/** A group chat: one thread from every member's side, live answers, and the members. */
export function GroupChat({ initial, others }: { readonly initial: GroupState; readonly others: ReadonlyArray<{ readonly id: string; readonly name: string }> }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [sent, setSent] = useState<DisplayMessage[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const pending = useRef(new Set(initial.runs.map((run) => run.runId)));
  const url = `/api/groups/${encodeURIComponent(state.group.id)}`;
  const memberOf = (id: string) => state.members.find((member) => member.id === id);
  const renderText = mentions(state.members.map((member) => member.name));

  useEffect(() => setState(initial), [initial]);

  const refresh = useCallback(async () => {
    const next = await getJson<GroupState>(url);
    pending.current = new Set(next.runs.map((run) => run.runId));
    setState(next);
    setSent([]);
  }, [url]);

  // Answers that started elsewhere, and approvals, between messages.
  useEffect(() => {
    if (state.runs.length > 0) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, 8_000);
    return () => clearInterval(timer);
  }, [state.runs.length, refresh]);

  async function send(text: string) {
    setSent((current) => [...current, { id: `sent-${Date.now()}`, sender: "person", text }]);
    try {
      const { runs } = await postJson<{ runs: Array<{ botId: string; runId: string }> }>(url, { text });
      for (const run of runs) pending.current.add(run.runId);
      setState((current) => ({ ...current, runs: [...current.runs, ...runs] }));
    } catch (error) {
      setSent((current) => current.slice(0, -1));
      throw error;
    }
  }

  function ended(runId: string) {
    pending.current.delete(runId);
    if (pending.current.size === 0) void refresh();
  }

  async function decide(approvalId: string, decision: ApprovalDecision) {
    await postJson(`/api/approvals/${encodeURIComponent(approvalId)}`, { decision });
    setState((current) => ({ ...current, approvals: current.approvals.filter((item) => item.id !== approvalId) }));
  }

  return (
    <>
      <section aria-label={state.group.name} className="chat group">
        <div className="chat-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1>{state.group.name}</h1>
            <span className="sub">Bots answer when you mention them, or all of them when you mention nobody. One with nothing to add stays quiet.</span>
          </div>
        </div>
        <div className="chat-scroll">
          <div className="chat-body">
            <Thread
              messages={[...state.messages, ...sent]}
              authorOf={(message) => {
                const member = memberOf(state.authors[message.id] ?? "");
                return member ? { name: member.name, initials: member.initials } : undefined;
              }}
              renderText={renderText}
              empty={<p className="muted" style={{ margin: 0, fontSize: 15 }}>Say what&apos;s going on. Mention a bot with @ to ask just that one.</p>}
            >
              {state.runs.map((run) => (
                <LiveReply
                  key={run.runId}
                  runId={run.runId}
                  renderText={renderText}
                  onEnd={() => ended(run.runId)}
                  onApproval={() => void getJson<GroupState>(url).then((next) => setState((current) => ({ ...current, approvals: next.approvals })))}
                  {...(memberOf(run.botId) ? { member: memberOf(run.botId)! } : {})}
                />
              ))}
              {state.approvals.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} onDecide={(decision) => decide(approval.id, decision)} />
              ))}
            </Thread>
          </div>
        </div>
        <div className="chat-foot">
          <Composer label={`Message ${state.group.name}`} placeholder="Message the group. @ a bot, or @everyone" onSend={send} />
        </div>
      </section>

      <aside aria-label="Members" className="side narrow right">
        <h2 className="label" style={{ padding: "0 8px" }}>MEMBERS</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2, fontSize: 15 }}>
          {state.members.map((member) => (
            <li key={member.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, minHeight: 44 }}>
              <span aria-hidden="true" style={avatarStyle(28)}>{member.initials}</span>{member.name}
            </li>
          ))}
        </ul>
        {others.length > 0 && state.members.length < 6 ? (
          adding === null ? (
            <button type="button" className="button" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(others[0]!.id)}>Add a bot</button>
          ) : (
            <form
              style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}
              onSubmit={async (event) => {
                event.preventDefault();
                await postJson(`${url}/members`, { botId: adding });
                setAdding(null);
                router.refresh();
              }}
            >
              <label htmlFor="add-bot" className="hidden-label">Bot to add</label>
              <select id="add-bot" className="input" value={adding} onChange={(event) => setAdding(event.target.value)} style={{ width: "100%" }}>
                {others.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="button primary">Add</button>
                <button type="button" className="button" onClick={() => setAdding(null)}>Cancel</button>
              </div>
            </form>
          )
        ) : null}
      </aside>
    </>
  );
}
