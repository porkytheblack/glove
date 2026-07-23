"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../lib/client/useSession";
import { useVoice } from "../lib/client/useVoice";
import { SCENARIOS } from "../lib/client/scenarios";
import { CHEAT_ADDRESSING, CHEAT_SALES, CHEAT_SHIPS, CHEAT_TODAY } from "../lib/client/cheatsheet";
import type { MetricRecord, Phase, SessionEvent, SpeakerRole } from "../lib/shared/types";

const SPK_COLOR: Record<SpeakerRole, string> = {
  operator: "var(--operator)",
  customer: "var(--customer)",
  bystander: "var(--bystander)",
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Idle",
  listening: "Listening",
  front: "Nova is listening / responding…",
  relay: "Nova is relaying the result…",
};

function shortNameFor(role: SpeakerRole, speakers: { id: string; shortName: string }[]): string {
  return speakers.find((s) => s.id === role)?.shortName ?? role;
}

const clip = (t: string, n = 200) => (t.length > n ? t.slice(0, n) + "…" : t);

// ── Latency HUD ──────────────────────────────────────────────────────────────
function MetricsHud({ metrics }: { metrics: MetricRecord[] }) {
  const [showRaw, setShowRaw] = useState(false);
  const derived = useMemo(() => {
    const latest = (name: string) => {
      for (let i = metrics.length - 1; i >= 0; i--) {
        if (metrics[i].name === name && typeof metrics[i].ms === "number") return metrics[i].ms!;
      }
      return undefined;
    };
    const avg = (name: string) => {
      const xs = metrics.filter((m) => m.name === name && typeof m.ms === "number").map((m) => m.ms!);
      return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined;
    };
    const count = (name: string) => metrics.filter((m) => m.name === name).length;
    return { latest, avg, count };
  }, [metrics]);

  const fmt = (v?: number) => (v == null ? "—" : `${v}ms`);

  const rows: { label: string; value?: number; avg?: number; hero?: boolean }[] = [
    { label: "Time to first audio", value: derived.latest("time_to_first_audio_ms"), avg: derived.avg("time_to_first_audio_ms"), hero: true },
    { label: "First spoken token", value: derived.latest("front_ttft_ms"), avg: derived.avg("front_ttft_ms") },
    { label: "STT finalize", value: derived.latest("stt_final_ms"), avg: derived.avg("stt_final_ms") },
    { label: "Worker (research)", value: derived.latest("worker_ms"), avg: derived.avg("worker_ms") },
    { label: "Worker queue wait", value: derived.latest("worker_queue_wait_ms"), avg: derived.avg("worker_queue_wait_ms") },
    { label: "Relay", value: derived.latest("relay_ms"), avg: derived.avg("relay_ms") },
    { label: "Delegation round-trip", value: derived.latest("delegation_roundtrip_ms"), avg: derived.avg("delegation_roundtrip_ms") },
    { label: "Speech queue wait (§5 gate)", value: derived.latest("speech_queue_wait_ms"), avg: derived.avg("speech_queue_wait_ms") },
  ];

  const counters = [
    `${derived.count("barge_in")} barge-ins`,
    `${derived.count("relay_skipped")} relays user-turn-won`,
    `${derived.count("speech_tag_unclosed")} tag issues`,
    `${derived.count("worker_no_reply")} silent worker runs`,
  ].join(" · ");

  return (
    <div className="hud">
      <div className="hud-head">
        <span>Latency</span>
        <span className="hud-sub">{counters}</span>
        <button className="hud-toggle" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? "hide raw" : "raw feed"}
        </button>
      </div>
      {showRaw && (
        <div className="hud-raw">
          {metrics.length === 0 && <div className="hud-raw-line">no metrics yet</div>}
          {metrics.slice(-80).map((m, i) => (
            <div key={i} className="hud-raw-line">
              <span className="t">{m.ts.slice(11, 23)}</span>{" "}
              <span className="s">{m.source}</span> <span className="n">{m.name}</span>
              {m.ms != null && <span className="ms"> {m.ms}ms</span>}
              {m.data && <span className="d"> {JSON.stringify(m.data)}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="hud-grid">
        {rows.map((r) => (
          <div className={`hud-item${r.hero ? " hero" : ""}`} key={r.label}>
            <div className="hud-label">{r.label}</div>
            <div className="hud-value">
              {fmt(r.value)}
              {r.avg != null && <span className="hud-avg">avg {r.avg}ms</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Console() {
  const [speaker, setSpeaker] = useState<SpeakerRole>("operator");
  const [text, setText] = useState("");
  const [metrics, setMetrics] = useState<MetricRecord[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCheats, setShowCheats] = useState(false);
  const roomRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const speakerRef = useRef<SpeakerRole>("operator");
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null);

  useEffect(() => {
    speakerRef.current = speaker;
  }, [speaker]);

  const appendMetric = useCallback(
    (m: MetricRecord) => setMetrics((x) => [...x, m].slice(-300)),
    [],
  );

  // Tap the raw event stream: stream Nova's tokens into TTS (audio starts on the
  // first token) + collect server metrics.
  const onServerEvent = useCallback(
    (e: SessionEvent) => {
      if (e.type === "metric") appendMetric(e.metric);
      else if (e.type === "delta" && e.role === "front") voiceRef.current?.feedDelta(e.text);
      else if (e.type === "say" && e.role === "front") voiceRef.current?.endTurn(e.text);
      // Worker just finished → the relay turn is imminent; open the TTS socket
      // now so the relay doesn't pay the ~1.2s cold handshake.
      else if (e.type === "worker_busy" && !e.busy) voiceRef.current?.prewarm();
      // A failed front turn ends without a `say` — still close out the voice
      // turn so a post-barge-in suppression can't leak onto the next turn.
      else if (e.type === "error") voiceRef.current?.endTurn();
    },
    [appendMetric],
  );

  const s = useSession({ onEvent: onServerEvent });

  const postAudioEvent = useCallback(
    (body: { type: string; heard?: string; detail?: string }) => {
      const id = s.config?.sessionId;
      if (!id) return;
      fetch(`/api/session/${id}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [s.config?.sessionId],
  );

  const voice = useVoice({
    sessionId: s.config?.sessionId ?? null,
    onUtterance: (sp, t) => void s.send(sp, t),
    getSpeaker: () => speakerRef.current,
    onMetric: appendMetric,
    // Audio-channel realities → tagged notices in Nova's history.
    onInterruption: (heard) => postAudioEvent({ type: "user-interruption", heard }),
    onSpeechFailure: (detail) => postAudioEvent({ type: "speech-failure", detail }),
  });
  voiceRef.current = voice;

  useEffect(() => {
    roomRef.current?.scrollTo({ top: roomRef.current.scrollHeight, behavior: "smooth" });
  }, [s.room, s.streaming]);
  useEffect(() => {
    backRef.current?.scrollTo({ top: backRef.current.scrollHeight, behavior: "smooth" });
  }, [s.backstage]);

  const speakers = s.config?.speakers ?? [];
  const blocked = !s.ready || s.busy;
  const hasKeyError = !!s.error && /api key|provider|model/i.test(s.error);

  function submit() {
    const t = text.trim();
    if (!t || blocked) return;
    setText("");
    if (voice.enabled) voice.markUtteranceSent();
    void s.send(speaker, t);
  }

  const voiceStatus = !voice.enabled
    ? "off"
    : voice.speaking
      ? "speaking"
      : voice.listening
        ? "listening"
        : voice.ready
          ? "idle"
          : "starting";

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Orbital Dynamics · Layered Voice Agents</h1>
          <div className="sub">
            front (Nova) → worker over the mesh · Nova hears everyone, speaks only via
            &lt;speech&gt; tags
          </div>
        </div>
        <div className="spacer" />
        <div className="phase-pill" data-active={s.phase !== "idle"}>
          <span className="dot" />
          {PHASE_LABEL[s.phase]}
        </div>
        {s.workerBusy && (
          <div className="phase-pill worker-pill" data-active="true">
            <span className="dot" />
            Worker researching in background…
          </div>
        )}
        <button
          className="reset-btn"
          data-active={showCheats}
          onClick={() => setShowCheats((v) => !v)}
          title="What's in the seeded database — hulls, owners, and lines to try"
        >
          📋 Cheat sheet
        </button>
        <button className="reset-btn" onClick={() => s.reset()} title="Start a fresh session">
          New session
        </button>
        <button
          className="reset-btn"
          title="Wipe persisted data (SQLite rows + metrics file) and start fresh"
          onClick={async () => {
            await fetch("/api/admin/clear", { method: "POST" }).catch(() => {});
            setMetrics([]);
            s.reset();
          }}
        >
          Clear data
        </button>
      </header>

      {s.error && (
        <div className="banner">
          {hasKeyError ? (
            <>
              Couldn&apos;t start the agents: <strong>{s.error}</strong>
              <br />
              Set <code>OPENROUTER_API_KEY</code> (or your provider&apos;s key) in{" "}
              <code>.env.local</code> and click <em>New session</em>. See{" "}
              <code>.env.example</code>.
            </>
          ) : (
            s.error
          )}
        </div>
      )}
      {voice.error && (
        <div className="banner">
          Voice: <strong>{voice.error}</strong> — check <code>ELEVENLABS_API_KEY</code> and mic
          permission.
        </div>
      )}

      {showCheats && (
        <div className="cheats">
          <div className="cheats-head">
            <span>
              Cheat sheet · shop date is <strong>{CHEAT_TODAY}</strong> · click any line to load
              it (or just read it into the mic)
            </span>
            <button className="hud-toggle" onClick={() => setShowCheats(false)}>
              close
            </button>
          </div>
          <div className="cheats-cols">
            <div className="cheats-col">
              <div className="cheats-title">Hero hulls — service &amp; warranty scenes</div>
              {CHEAT_SHIPS.map((ship) => (
                <div className="cheat-card" key={ship.hullId}>
                  <div className="cheat-card-head">
                    <strong>{ship.hullId}</strong> “{ship.nickname}” · {ship.model}
                  </div>
                  <div className="cheat-owner">{ship.owner}</div>
                  <div className="cheat-hook">{ship.hook}</div>
                  <div className="cheat-lines">
                    {ship.ask.map((line) => (
                      <button className="cheat-line" key={line} onClick={() => setText(line)}>
                        {line}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="cheats-col">
              <div className="cheats-title">Sales &amp; bookings — no hull needed</div>
              <div className="cheat-lines">
                {CHEAT_SALES.map((line) => (
                  <button className="cheat-line" key={line} onClick={() => setText(line)}>
                    {line}
                  </button>
                ))}
              </div>
              <div className="cheats-title">Addressing test — switch who&apos;s speaking</div>
              {CHEAT_ADDRESSING.map((entry) => (
                <div className="cheat-card" key={entry.line}>
                  <div className="cheat-lines">
                    <button
                      className="cheat-line"
                      onClick={() => {
                        setSpeaker(entry.as as SpeakerRole);
                        setText(entry.line);
                      }}
                    >
                      [{entry.as}] {entry.line}
                    </button>
                  </div>
                  <div className="cheat-hook">→ {entry.expect}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="main">
        {/* ── Room ── */}
        <section className="col room">
          <div className="col-head">Room · the conversation</div>
          <div className="col-body" ref={roomRef}>
            {s.room.length === 0 && !s.streaming && (
              <div className="empty">
                Turn on the mic and speak, or type as <strong>Sam</strong>, the walk-in{" "}
                <strong>customer</strong>, or the technician <strong>Kit</strong>.
                <br />
                Nova hears every line and decides for herself whether it was aimed at her — she
                only produces audio by wrapping words in &lt;speech&gt; tags, and delegates the
                heavy lookups to the worker.
                <br />
                <br />
                Try a scripted scene below to see it end-to-end.
              </div>
            )}

            {s.room.map((it) =>
              it.kind === "note" ? (
                <div className="room-note" key={it.id} data-kind={it.noteKind}>
                  ⚡ {it.text}
                </div>
              ) : it.kind === "utterance" ? (
                <div className="turn" key={it.id}>
                  <div
                    className={`utterance${it.silent ? " silent" : ""}`}
                    style={{ "--spk": SPK_COLOR[it.speaker] } as React.CSSProperties}
                  >
                    <div className="spk-row">
                      <span className="spk-name">{shortNameFor(it.speaker, speakers)}</span>
                      <span className="spk-tag">{it.speaker}</span>
                    </div>
                    <div className="body">{it.text}</div>
                  </div>
                  {it.silent && (
                    <div className="silent-note">
                      Nova stayed quiet — she judged this wasn&apos;t for her.
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
                Delegations, worker tool calls, and replies show up here. The front agent stays
                thin; the worker carries the tool surface.
              </div>
            )}
            {s.backstage.map((b) => {
              const full = b.detail ?? b.content;
              const expandable = full.includes("\n") || full.length > 160 || full !== b.content;
              const isOpen = expanded.has(b.id);
              return (
                <div
                  className={`backstage-item ${b.kind}${expandable ? " expandable" : ""}`}
                  key={b.id}
                  onClick={() => {
                    if (!expandable) return;
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      return next;
                    });
                  }}
                  title={expandable ? "Click to expand / collapse" : undefined}
                >
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
                      {expandable && <span className="bi-caret">{isOpen ? "▾" : "▸"}</span>}
                    </div>
                    {isOpen ? (
                      <pre className="bi-detail">{full}</pre>
                    ) : (
                      <div className={b.kind === "tool" ? "summary" : "content"}>
                        {clip(b.content)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <MetricsHud metrics={metrics} />

          <div className="stats">
            {(
              [
                { role: "front", label: "Front (Nova)", color: "var(--nova)" },
                { role: "worker", label: "Worker", color: "var(--worker)" },
              ] as const
            ).map(({ role, label, color }) => (
              <div className="stat" key={role}>
                <div className="role">
                  <span className="swatch" style={{ background: color }} />
                  {label}
                </div>
                <div className="num">
                  {(s.stats[role].tokensIn + s.stats[role].tokensOut).toLocaleString()}{" "}
                  <small>tok</small>
                </div>
                <div className="turns">{s.stats[role].turns} turns</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Input dock ── */}
      <div className="dock">
        {voice.enabled && (
          <div className={`voice-live ${voiceStatus}`}>
            <span className="vl-dot" />
            <span className="vl-label">
              {voiceStatus === "speaking"
                ? "Nova speaking"
                : voiceStatus === "listening"
                  ? `Listening as ${shortNameFor(speaker, speakers)}`
                  : voiceStatus === "starting"
                    ? "Starting mic…"
                    : "Mic idle"}
            </span>
            {voice.partial && <span className="vl-partial">“{voice.partial}”</span>}
            {voice.interruptions > 0 && (
              <span className="vl-barge">{voice.interruptions} barge-in{voice.interruptions > 1 ? "s" : ""}</span>
            )}
          </div>
        )}
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
          <button
            className={`mic-btn ${voiceStatus}`}
            onClick={() => (voice.enabled ? void voice.disable() : void voice.enable())}
            disabled={!s.ready}
            title={voice.enabled ? "Turn the mic off" : "Turn on the mic (full-duplex voice)"}
          >
            {voice.enabled ? "● Mic on" : "🎙 Mic"}
          </button>
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
