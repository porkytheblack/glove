"use client";

// Speech-to-speech mode: gpt-realtime IS the front agent (persona, addressing
// judgment, turn-taking and the voice all in one model over WebRTC), while
// the SAME heavy text worker researches behind the delegate_to_worker tool.
// Compare against the cascaded pipeline on the main page — especially the
// VOICE-TO-VOICE number, measured here as the real gap between the user
// going quiet and Nova's audio starting.
//
// The wiring is `useGloveS2S` + a tool host: the session publishes whatever
// the server-side host declares and routes every tool call back to it, so
// this page contains no tool dispatch, no schema, and no latency stopwatch.

import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeAdapter, httpToolHost } from "glove-voice-s2s";
import { useGloveS2S } from "glove-react/s2s";
import type { MetricRecord } from "../lib/shared/types";

interface LogLine {
  id: number;
  who: "you" | "nova" | "system";
  text: string;
}

const STATUS: Record<string, string> = {
  idle: "idle",
  connecting: "connecting…",
  listening: "listening",
  user_speaking: "you're speaking",
  thinking: "thinking",
  speaking: "nova speaking",
};

export default function S2SPage() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [v2v, setV2v] = useState<number[]>([]);
  const seq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const append = useCallback((who: LogLine["who"], text: string) => {
    setLog((l) => [...l.slice(-120), { id: ++seq.current, who, text }]);
  }, []);

  const postMetric = useCallback((name: string, ms?: number, data?: Record<string, unknown>) => {
    const rec: MetricRecord = {
      ts: new Date().toISOString(),
      sessionId: "s2s",
      source: "client",
      name,
      ...(ms != null ? { ms: Math.round(ms) } : {}),
      ...(data ? { data } : {}),
    };
    fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec),
    }).catch(() => {});
  }, []);

  const s2s = useGloveS2S({
    adapter: () =>
      new OpenAIRealtimeAdapter({
        getToken: async () => {
          const res = await fetch("/api/voice/s2s-token", { method: "POST" });
          const data = await res.json();
          if (!res.ok || !data.token) throw new Error(data.error ?? "token mint failed");
          return data.token as string;
        },
      }),
    // Tool calls travel to the worker behind /api/s2s/tools. The declarations
    // were already baked into the token, so no list round trip is needed.
    tools: httpToolHost({ endpoint: "/api/s2s/tools" }),
    publishTools: false,
  });

  // Transcript + delegation log, straight off the session's events.
  useEffect(() => {
    const session = s2s.session;
    if (!session) return;

    const onUser = (text: string, isFinal: boolean) => {
      if (isFinal && text.trim()) append("you", text.trim());
    };
    const onNova = (text: string) => {
      if (text.trim()) append("nova", text.trim());
    };
    const onInterrupted = () => append("system", "interrupted — nova cut off");
    const onToolStart = ({ name, input }: { name: string; input: unknown }) => {
      const request = String((input as { request?: unknown })?.request ?? "");
      append("system", `${name} → worker: ${request.slice(0, 120)}`);
    };
    const onToolEnd = ({ ms, ok }: { ms: number; ok: boolean }) => {
      append("system", ok ? `worker replied in ${(ms / 1000).toFixed(1)}s` : `worker failed after ${(ms / 1000).toFixed(1)}s`);
      postMetric("s2s_delegation_roundtrip_ms", ms, { ok });
    };
    // The headline number: real voice-to-voice, user quiet → Nova audible.
    const onV2v = (ms: number) => {
      setV2v((xs) => [...xs.slice(-19), ms]);
      postMetric("s2s_voice_to_voice_ms", ms);
    };
    const onConnected = () => append("system", "connected — just talk");

    session.on("connected", onConnected);
    session.on("user_transcript", onUser);
    session.on("agent_transcript_done", onNova);
    session.on("interrupted", onInterrupted);
    session.on("tool_start", onToolStart);
    session.on("tool_end", onToolEnd);
    session.on("voice_to_voice", onV2v);

    return () => {
      session.off("connected", onConnected);
      session.off("user_transcript", onUser);
      session.off("agent_transcript_done", onNova);
      session.off("interrupted", onInterrupted);
      session.off("tool_start", onToolStart);
      session.off("tool_end", onToolEnd);
      session.off("voice_to_voice", onV2v);
    };
  }, [s2s.session, append, postMetric]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  const avg = v2v.length ? Math.round(v2v.reduce((a, b) => a + b, 0) / v2v.length) : null;
  const error = s2s.error?.message ?? null;
  const workerBusy = s2s.toolsRunning.length;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Orbital Dynamics · Speech-to-Speech mode</h1>
          <div className="sub">
            gpt-realtime IS the front agent (WebRTC, semantic turn-taking) · same heavy worker
            behind the delegate tool · <a href="/">↩ cascaded mode</a>
          </div>
        </div>
        <div className="spacer" />
        <div className="phase-pill" data-active={s2s.enabled}>
          <span className="dot" />
          {STATUS[s2s.state] ?? s2s.state}
        </div>
        {workerBusy > 0 && (
          <div className="phase-pill worker-pill" data-active="true">
            <span className="dot" />
            Worker researching…
          </div>
        )}
        <button
          className="reset-btn"
          onClick={() => (s2s.enabled ? void s2s.stop() : void s2s.start())}
        >
          {s2s.enabled ? "Hang up" : "🎙 Connect"}
        </button>
      </header>

      {error && (
        <div className="banner">
          {error}
          {/OPENAI_API_KEY/.test(error) && (
            <>
              {" "}
              — add it to <code>.env.local</code> and restart.
            </>
          )}
        </div>
      )}

      <div className="main">
        <section className="col room">
          <div className="col-head">Conversation</div>
          <div className="col-body" ref={logRef}>
            {log.length === 0 && (
              <div className="empty">
                Connect and talk. Turn-taking, barge-in, and endpointing are the MODEL&apos;s job
                here — no client heuristics. Ask about hull KES-0007 to see a delegation.
              </div>
            )}
            {log.map((l) =>
              l.who === "system" ? (
                <div className="room-note" key={l.id}>
                  ⚡ {l.text}
                </div>
              ) : (
                <div className={l.who === "nova" ? "nova" : "turn"} key={l.id}>
                  <div className="spk-row">
                    <span className="spk-name">{l.who === "nova" ? "Nova" : "You"}</span>
                  </div>
                  <div className="body">{l.text}</div>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="col">
          <div className="col-head">Voice-to-voice · you stop → Nova audible</div>
          <div className="col-body">
            <div className="hud" style={{ border: "none" }}>
              <div className="hud-grid">
                <div className="hud-item hero">
                  <div className="hud-label">Latest</div>
                  <div className="hud-value">
                    {v2v.length ? `${v2v[v2v.length - 1]}ms` : "—"}
                    {avg != null && <span className="hud-avg">avg {avg}ms</span>}
                  </div>
                </div>
              </div>
              <div className="hud-raw" style={{ display: "block", maxHeight: 260 }}>
                {v2v.length === 0 && <div className="hud-raw-line">no turns yet</div>}
                {v2v.map((ms, i) => (
                  <div className="hud-raw-line" key={i}>
                    turn {i + 1}: <span className="ms">{ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
