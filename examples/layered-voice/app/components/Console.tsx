"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../lib/client/useSession";
import { SCENARIOS } from "../lib/client/scenarios";
import type { Addressee, Phase, SpeakerRole } from "../lib/shared/types";

const SPK_COLOR: Record<SpeakerRole, string> = {
  operator: "var(--operator)",
  customer: "var(--customer)",
  bystander: "var(--bystander)",
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Idle",
  listening: "Listening",
  classifying: "Monitor: reading the room…",
  front: "Nova is responding…",
  worker: "Worker is researching…",
  relay: "Nova is relaying the result…",
};

const ADDR_LABEL: Record<Addressee, string> = {
  assistant: "→ Nova",
  human: "→ a person",
  ambiguous: "ambiguous",
};

function shortNameFor(role: SpeakerRole, speakers: { id: string; shortName: string }[]): string {
  return speakers.find((s) => s.id === role)?.shortName ?? role;
}

export default function Console() {
  const s = useSession();
  const [speaker, setSpeaker] = useState<SpeakerRole>("operator");
  const [text, setText] = useState("");
  const roomRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    roomRef.current?.scrollTo({ top: roomRef.current.scrollHeight, behavior: "smooth" });
  }, [s.room, s.streaming]);
  useEffect(() => {
    backRef.current?.scrollTo({ top: backRef.current.scrollHeight, behavior: "smooth" });
  }, [s.backstage]);

  const speakers = s.config?.speakers ?? [];
  const blocked = !s.ready || s.busy;
  const hasKeyError = !!s.error && /api key|provider|model/i.test(s.error);

  const totalTokens = useMemo(
    () => (r: { tokensIn: number; tokensOut: number }) => r.tokensIn + r.tokensOut,
    [],
  );

  function submit() {
    const t = text.trim();
    if (!t || blocked) return;
    setText("");
    void s.send(speaker, t);
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Orbital Dynamics · Layered Voice Agents</h1>
          <div className="sub">
            front (Nova) → worker over the mesh · a passive monitor decides who each line is for
          </div>
        </div>
        <div className="spacer" />
        <div className="phase-pill" data-active={s.phase !== "idle"}>
          <span className="dot" />
          {PHASE_LABEL[s.phase]}
        </div>
        <button className="reset-btn" onClick={() => s.reset()} title="Start a fresh session">
          New session
        </button>
      </header>

      {s.error && (
        <div className="banner">
          {hasKeyError ? (
            <>
              Couldn&apos;t start the agents: <strong>{s.error}</strong>
              <br />
              Set <code>ANTHROPIC_API_KEY</code> (or your provider&apos;s key) in{" "}
              <code>.env.local</code> and click <em>New session</em>. See{" "}
              <code>.env.example</code>.
            </>
          ) : (
            s.error
          )}
        </div>
      )}

      <div className="main">
        {/* ── Room ── */}
        <section className="col room">
          <div className="col-head">Room · the conversation</div>
          <div className="col-body" ref={roomRef}>
            {s.room.length === 0 && !s.streaming && (
              <div className="empty">
                Speak into the room as <strong>Sam</strong>, the walk-in{" "}
                <strong>customer</strong>, or the technician <strong>Kit</strong>.
                <br />
                The monitor decides whether each line is aimed at Nova or at another
                person. Nova only answers when she&apos;s addressed — and delegates the
                heavy lookups to the worker.
                <br />
                <br />
                Try a scripted scene below to see it end-to-end.
              </div>
            )}

            {s.room.map((it) =>
              it.kind === "utterance" ? (
                <div className="turn" key={it.id}>
                  <div
                    className={`utterance${it.silent ? " silent" : ""}`}
                    style={{ "--spk": SPK_COLOR[it.speaker] } as React.CSSProperties}
                  >
                    <div className="spk-row">
                      <span className="spk-name">{shortNameFor(it.speaker, speakers)}</span>
                      <span className="spk-tag">{it.speaker}</span>
                      {it.verdict && (
                        <span className="verdict" data-addr={it.verdict.addressee}>
                          <span className="vlabel">{ADDR_LABEL[it.verdict.addressee]}</span>
                          <span className="conf">{Math.round(it.verdict.confidence * 100)}%</span>
                        </span>
                      )}
                    </div>
                    <div className="body">{it.text}</div>
                  </div>
                  {it.verdict && <div className="verdict-reason">monitor: {it.verdict.reason}</div>}
                  {it.silent && (
                    <div className="silent-note">
                      Nova stayed quiet — not addressed to her.
                    </div>
                  )}
                </div>
              ) : (
                <div className={`nova${it.sayKind === "relay" ? " relay" : ""}`} key={it.id}>
                  <div className="spk-row">
                    <span className="spk-name">Nova</span>
                    {it.sayKind === "relay" && <span className="relay-tag">proactive relay</span>}
                  </div>
                  <div className="body">{it.text}</div>
                </div>
              ),
            )}

            {s.streaming && (
              <div className="nova streaming">
                <div className="spk-row">
                  <span className="spk-name">Nova</span>
                </div>
                <div className="body">
                  {s.streaming}
                  <span className="cursor" />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Backstage ── */}
        <section className="col">
          <div className="col-head">Backstage · the layered machinery</div>
          <div className="col-body" ref={backRef}>
            {s.backstage.length === 0 && (
              <div className="empty">
                Delegations, worker tool calls, and replies show up here. The front agent
                stays thin; the worker carries the tool surface.
              </div>
            )}
            {s.backstage.map((b) => (
              <div className={`backstage-item ${b.kind}`} key={b.id}>
                <div className="bi-icon">
                  {b.kind === "delegate" ? "↗" : b.kind === "reply" ? "↩" : "⚙"}
                </div>
                <div className="bi-body">
                  <div className="bi-title">
                    {b.kind === "delegate"
                      ? "Nova → Worker · blocking delegate"
                      : b.kind === "reply"
                        ? "Worker → Nova · reply (in_reply_to)"
                        : `Worker · ${b.name}`}
                  </div>
                  <div className={b.kind === "tool" ? "summary" : "content"}>{b.content}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="stats">
            {(
              [
                { role: "front", label: "Front (Nova)", color: "var(--nova)" },
                { role: "worker", label: "Worker", color: "var(--worker)" },
                { role: "monitor", label: "Monitor", color: "var(--muted)" },
              ] as const
            ).map(({ role, label, color }) => (
              <div className="stat" key={role}>
                <div className="role">
                  <span className="swatch" style={{ background: color }} />
                  {label}
                </div>
                <div className="num">
                  {totalTokens(s.stats[role]).toLocaleString()} <small>tok</small>
                </div>
                <div className="turns">{s.stats[role].turns} turns</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Input dock ── */}
      <div className="dock">
        <div className="row">
          <div className="speaker-select">
            {speakers.map((sp) => (
              <button
                key={sp.id}
                data-active={speaker === sp.id}
                style={{ "--spk": SPK_COLOR[sp.id as SpeakerRole] } as React.CSSProperties}
                onClick={() => setSpeaker(sp.id as SpeakerRole)}
                title={sp.description}
              >
                {sp.shortName}
              </button>
            ))}
          </div>
          <input
            className="text"
            value={text}
            placeholder={`Say something as ${shortNameFor(speaker, speakers)}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            disabled={!s.ready}
          />
          <button className="send" onClick={submit} disabled={blocked || !text.trim()}>
            {s.busy ? "…" : "Send"}
          </button>
        </div>
        <div className="row scenario-bar">
          <span className="label">Scenarios</span>
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              className="chip"
              disabled={blocked}
              title={sc.blurb}
              onClick={() => void s.playScenario(sc.lines)}
            >
              {sc.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
