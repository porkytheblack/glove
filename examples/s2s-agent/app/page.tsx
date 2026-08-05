"use client";

// One Glove agent, two speech-to-speech runtimes.
//
// The agent (app/lib/agent.ts) is authored like any Glove agent. This page
// hands it to RealtimeAgent with either adapter:
//   - OpenAI Realtime — DEVICE mode: WebRTC owns the mic and speakers, the
//     page wires nothing.
//   - Gemini Live — TRANSPORT mode: the page captures mic PCM (16 kHz in) and
//     plays reply PCM (24 kHz out) through app/lib/audio.ts.
//
// Try saying: "what time is it", "switch to the sunset theme",
// "note down: buy oat milk", "what are my notes?"

import { useEffect, useRef, useState } from "react";
import { createS2SAdapter, RealtimeAgent } from "glove-voice-s2s";
import { buildAgent, uiBridge, type Theme } from "./lib/agent";
import { createPcmPlayer, startMicCapture, type PcmPlayer } from "./lib/audio";

type Provider = "openai" | "gemini";

interface LogLine {
  kind: "user" | "agent" | "tool" | "info" | "error";
  text: string;
}

const THEMES: Record<Theme, { bg: string; fg: string; card: string }> = {
  light: { bg: "#f5f5f4", fg: "#1c1917", card: "#ffffff" },
  dark: { bg: "#18181b", fg: "#e4e4e7", card: "#27272a" },
  ocean: { bg: "#0c4a6e", fg: "#e0f2fe", card: "#075985" },
  sunset: { bg: "#7c2d12", fg: "#ffedd5", card: "#9a3412" },
};

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.error ?? `token fetch failed (${res.status})`);
  return data.token;
}

export default function S2SAgentPage() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [notes, setNotes] = useState<string[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [injectText, setInjectText] = useState("");

  const rtRef = useRef<RealtimeAgent | null>(null);
  const stopMicRef = useRef<(() => void) | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const notesRef = useRef<string[]>([]);

  const append = (line: LogLine) => setLog((l) => [...l.slice(-60), line]);

  // Register the page as the tool target (tools run outside the React tree).
  useEffect(() => {
    uiBridge.current = {
      setTheme: (t) => setTheme(t),
      addNote: (text) => {
        notesRef.current = [...notesRef.current, text];
        setNotes(notesRef.current);
        return notesRef.current;
      },
      getNotes: () => notesRef.current,
    };
    return () => {
      uiBridge.current = null;
    };
  }, []);

  async function start() {
    setBusy(true);
    try {
      // The factory, browser-style: getToken (never a raw key client-side),
      // voice as typed config, provider picking the mode — "openai-webrtc"
      // is DEVICE (owns mic + speakers), "gemini" is TRANSPORT (PCM only).
      const adapter =
        provider === "openai"
          ? createS2SAdapter({
              provider: "openai-webrtc",
              getToken: () => fetchToken("/api/s2s/openai-token"),
              voice: "marin",
            })
          : createS2SAdapter({
              provider: "gemini",
              getToken: () => fetchToken("/api/s2s/gemini-token"),
              voice: "Puck",
              // Typed turn-taking knob: wait a little longer before deciding
              // the user finished — friendlier for think-out-loud requests.
              realtimeInput: {
                automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW" },
              },
            });

      const rt = new RealtimeAgent({
        agent: buildAgent(),
        adapter,
        onToolCall: (name, phase, detail) => {
          if (phase === "start") append({ kind: "tool", text: `⚙ ${name}(${JSON.stringify(detail)})` });
          if (phase === "error") append({ kind: "error", text: `⚙ ${name} failed: ${String(detail)}` });
        },
      });

      rt.on("user_said", (t) => append({ kind: "user", text: t }));
      rt.on("agent_said", (t) => {
        setLiveCaption("");
        append({ kind: "agent", text: t });
      });
      rt.on("agent_delta", (t) => setLiveCaption((c) => c + t));
      rt.on("error", (e) => append({ kind: "error", text: e.message }));

      // Transport mode: the page owns both ends of the audio path.
      if (rt.mode === "transport") {
        playerRef.current = createPcmPlayer();
        rt.adapter.on("audio", (pcm, format) => playerRef.current?.play(pcm, format.sampleRate));
        rt.adapter.on("interrupted", () => playerRef.current?.flush());
        stopMicRef.current = await startMicCapture(rt.adapter.inputFormat.sampleRate, (pcm) =>
          rt.sendAudio(pcm),
        );
      }

      await rt.start();
      rtRef.current = rt;
      setRunning(true);
      append({
        kind: "info",
        text: `connected — ${provider} (${rt.mode} mode), ${rt.exposedTools.length} tools exposed`,
      });
    } catch (e) {
      append({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      await teardown();
    } finally {
      setBusy(false);
    }
  }

  async function teardown() {
    stopMicRef.current?.();
    stopMicRef.current = null;
    await playerRef.current?.close();
    playerRef.current = null;
    await rtRef.current?.stop().catch(() => {});
    rtRef.current = null;
    setRunning(false);
    setLiveCaption("");
  }

  async function stop() {
    setBusy(true);
    await teardown();
    append({ kind: "info", text: "disconnected" });
    setBusy(false);
  }

  function inject() {
    if (!rtRef.current || !injectText.trim()) return;
    // The async-result path: text lands in the live conversation and the
    // model speaks about it — exactly how a finished delegation is relayed.
    rtRef.current.inject(injectText.trim(), { respond: true });
    append({ kind: "info", text: `injected: ${injectText.trim()}` });
    setInjectText("");
  }

  const t = THEMES[theme];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: t.bg,
        color: t.fg,
        transition: "background 300ms, color 300ms",
        padding: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: 760,
        margin: "0 auto",
      }}
    >
      <h1 style={{ margin: 0 }}>Glove × speech-to-speech</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        One Glove agent, its tools authored once — running on a realtime voice model. Ask for the
        time, a theme change (<em>light / dark / ocean / sunset</em>), or to pin a note.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={provider}
          disabled={running || busy}
          onChange={(e) => setProvider(e.target.value as Provider)}
          style={{ padding: "0.5rem", borderRadius: 8 }}
        >
          <option value="openai">OpenAI Realtime — device mode (WebRTC)</option>
          <option value="gemini">Gemini Live — transport mode (WebSocket)</option>
        </select>
        <button
          onClick={running ? stop : start}
          disabled={busy}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: running ? "#dc2626" : "#16a34a",
            color: "white",
            fontWeight: 600,
          }}
        >
          {busy ? "…" : running ? "Stop" : "Start talking"}
        </button>
      </div>

      {notes.length > 0 && (
        <section style={{ background: t.card, borderRadius: 12, padding: "1rem" }}>
          <strong>Pinned notes</strong>
          <ul style={{ margin: "0.5rem 0 0" }}>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <section
        style={{
          background: t.card,
          borderRadius: 12,
          padding: "1rem",
          minHeight: 220,
          display: "flex",
          flexDirection: "column",
          gap: "0.35rem",
          fontSize: "0.925rem",
        }}
      >
        {log.length === 0 && <span style={{ opacity: 0.6 }}>Transcript and tool calls appear here.</span>}
        {log.map((line, i) => (
          <div key={i} style={{ opacity: line.kind === "info" ? 0.65 : 1 }}>
            {line.kind === "user" && <strong>you: </strong>}
            {line.kind === "agent" && <strong>aria: </strong>}
            {line.kind === "error" && <strong style={{ color: "#f87171" }}>error: </strong>}
            {line.text}
          </div>
        ))}
        {liveCaption && <div style={{ opacity: 0.7, fontStyle: "italic" }}>aria: {liveCaption}…</div>}
      </section>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={injectText}
          disabled={!running}
          onChange={(e) => setInjectText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && inject()}
          placeholder='Inject text into the live call (e.g. "the build finished: all green")'
          style={{ flex: 1, padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #8884" }}
        />
        <button onClick={inject} disabled={!running} style={{ padding: "0.5rem 1rem", borderRadius: 8 }}>
          Inject
        </button>
      </div>
    </main>
  );
}
