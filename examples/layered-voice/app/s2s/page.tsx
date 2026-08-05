"use client";

// Speech-to-speech mode: gpt-realtime IS the front agent (persona, addressing
// judgment, turn-taking and the voice all in one model over WebRTC), while
// the SAME heavy text worker researches behind the delegate_to_worker tool.
// Compare against the cascaded pipeline on the main page — especially the
// VOICE-TO-VOICE number, measured here as the real gap between the user
// going quiet and Nova's audio starting.

import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeAdapter } from "glove-voice-s2s";
import type { MetricRecord } from "../lib/shared/types";

interface LogLine {
  id: number;
  who: "you" | "nova" | "system";
  text: string;
}

export default function S2SPage() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [v2v, setV2v] = useState<number[]>([]);
  const [workerBusy, setWorkerBusy] = useState(0);
  const adapterRef = useRef<OpenAIRealtimeAdapter | null>(null);
  const seq = useRef(0);
  const userStoppedAt = useRef(0);
  const novaLine = useRef("");
  const logRef = useRef<HTMLDivElement>(null);

  const append = useCallback((who: LogLine["who"], text: string) => {
    setLog((l) => [...l.slice(-120), { id: ++seq.current, who, text }]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

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

  const disconnect = useCallback(async () => {
    await adapterRef.current?.disconnect();
    adapterRef.current = null;
    setConnected(false);
    setStatus("idle");
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting…");
    const adapter = new OpenAIRealtimeAdapter({
      getToken: async () => {
        const res = await fetch("/api/voice/s2s-token", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.token) throw new Error(data.error ?? "token mint failed");
        return data.token as string;
      },
    });
    adapterRef.current = adapter;

    adapter.on("connected", () => {
      setConnected(true);
      setStatus("listening");
      append("system", "connected — just talk");
    });
    adapter.on("disconnected", () => setConnected(false));
    adapter.on("error", (e) => setError(e.message));

    adapter.on("user_speech_started", () => setStatus("you're speaking"));
    adapter.on("user_speech_stopped", () => {
      userStoppedAt.current = Date.now();
      setStatus("thinking");
    });
    adapter.on("user_transcript", (text, isFinal) => {
      if (isFinal && text.trim()) append("you", text.trim());
    });

    adapter.on("agent_speech_started", () => {
      setStatus("nova speaking");
      if (userStoppedAt.current) {
        const ms = Date.now() - userStoppedAt.current;
        userStoppedAt.current = 0;
        // The headline number: real voice-to-voice, user quiet → Nova audible.
        setV2v((xs) => [...xs.slice(-19), ms]);
        postMetric("s2s_voice_to_voice_ms", ms);
      }
    });
    adapter.on("agent_speech_stopped", () => setStatus("listening"));
    adapter.on("agent_transcript_delta", (d) => {
      novaLine.current += d;
    });
    adapter.on("agent_transcript_done", (text) => {
      novaLine.current = "";
      if (text.trim()) append("nova", text.trim());
    });
    adapter.on("interrupted", () => append("system", "interrupted — nova cut off"));

    // The delegation bridge: tool call → heavy worker over HTTP → result
    // injected back; the model then relays it out loud.
    adapter.on("tool_call", async ({ callId, name, arguments: rawArgs }) => {
      if (name !== "delegate_to_worker") {
        adapter.sendToolResult(callId, { error: `unknown tool ${name}` });
        return;
      }
      let request = "";
      try {
        request = String((JSON.parse(rawArgs) as { request?: string }).request ?? "");
      } catch {
        /* leave empty */
      }
      append("system", `delegating → worker: ${request.slice(0, 120)}`);
      setWorkerBusy((n) => n + 1);
      const t0 = Date.now();
      try {
        const res = await fetch("/api/s2s/delegate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `delegate failed (${res.status})`);
        append("system", `worker replied in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        postMetric("s2s_delegation_roundtrip_ms", Date.now() - t0);
        adapter.sendToolResult(callId, data.result);
      } catch (err) {
        adapter.sendToolResult(callId, {
          error: `The lookup failed: ${(err as Error)?.message ?? "unknown"}. Level with the customer.`,
        });
      } finally {
        setWorkerBusy((n) => Math.max(0, n - 1));
      }
    });

    try {
      await adapter.connect();
    } catch (err) {
      setError((err as Error)?.message ?? "connect failed");
      setStatus("idle");
      adapterRef.current = null;
    }
  }, [append, postMetric]);

  useEffect(() => () => void adapterRef.current?.disconnect(), []);

  const avg = v2v.length ? Math.round(v2v.reduce((a, b) => a + b, 0) / v2v.length) : null;

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
        <div className="phase-pill" data-active={connected}>
          <span className="dot" />
          {status}
        </div>
        {workerBusy > 0 && (
          <div className="phase-pill worker-pill" data-active="true">
            <span className="dot" />
            Worker researching…
          </div>
        )}
        <button className="reset-btn" onClick={() => (connected ? void disconnect() : void connect())}>
          {connected ? "Hang up" : "🎙 Connect"}
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
