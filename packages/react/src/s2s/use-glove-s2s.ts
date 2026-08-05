"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GloveS2S,
  type GloveS2SConfig,
  type S2SAdapter,
  type S2SState,
} from "glove-voice-s2s";

// ─── Config & return types ───────────────────────────────────────────────────

export interface UseGloveS2SConfig extends Omit<GloveS2SConfig, "adapter"> {
  /**
   * The provider session. Pass a FACTORY — the adapter opens the microphone
   * on connect, so it must not be constructed until `start()` is called.
   */
  adapter: () => S2SAdapter;
}

export interface UseGloveS2SReturn {
  /** idle → connecting → listening → user_speaking → thinking → speaking */
  state: S2SState;
  /** Whether the user has voice on. Flips back on a dropped connection. */
  enabled: boolean;
  isConnected: boolean;
  /** Last error from the session (cleared on the next `start()`). */
  error: Error | null;
  /** The user's most recent final transcript. */
  transcript: string;
  /** The agent's most recent finished utterance. */
  agentTranscript: string;
  /** Voice-to-voice for the last turn (ms) — user quiet → agent audible. */
  voiceToVoiceMs: number | null;
  /** Names of tool calls currently running. */
  toolsRunning: string[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Cut the agent off mid-sentence. */
  interrupt: () => void;
  /** Inject context and have the agent speak in reaction (async wakeup). */
  relay: (text: string) => void;
  /** Inject context the agent should know but not answer. */
  observe: (text: string) => void;
  /** The live session, for anything the hook doesn't surface. */
  session: GloveS2S | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * React binding for a speech-to-speech session.
 *
 * The mirror of `useGloveVoice`, one architecture layer down: there is no
 * VAD, STT, TTS, or turn detector to configure because the realtime model
 * owns all four. What you configure instead is where its tool calls run.
 *
 * @example
 * ```tsx
 * const s2s = useGloveS2S({
 *   adapter: () => new OpenAIRealtimeAdapter({
 *     getToken: async () => (await (await fetch("/api/voice/s2s-token", { method: "POST" })).json()).token,
 *   }),
 *   tools: httpToolHost({ endpoint: "/api/s2s/tools" }),
 * });
 *
 * <button onClick={s2s.enabled ? s2s.stop : s2s.start}>{s2s.state}</button>
 * ```
 */
export function useGloveS2S(config: UseGloveS2SConfig): UseGloveS2SReturn {
  const { adapter: createAdapter, ...sessionConfig } = config;

  const [state, setState] = useState<S2SState>("idle");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [transcript, setTranscript] = useState("");
  const [agentTranscript, setAgentTranscript] = useState("");
  const [voiceToVoiceMs, setVoiceToVoiceMs] = useState<number | null>(null);
  const [toolsRunning, setToolsRunning] = useState<string[]>([]);
  const [session, setSession] = useState<GloveS2S | null>(null);

  const sessionRef = useRef<GloveS2S | null>(null);
  const startingRef = useRef(false);

  // Keep the latest config visible to `start` without re-creating it on
  // every render — callers routinely pass inline object literals.
  const configRef = useRef(sessionConfig);
  configRef.current = sessionConfig;
  const adapterRef = useRef(createAdapter);
  adapterRef.current = createAdapter;

  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      sessionRef.current = null;
      if (s) {
        s.removeAllListeners();
        void s.stop();
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current?.isConnected || startingRef.current) return;

    setError(null);
    startingRef.current = true;

    const s2s = new GloveS2S({ ...configRef.current, adapter: adapterRef.current() });
    sessionRef.current = s2s;
    setSession(s2s);

    s2s.on("state", setState);
    s2s.on("error", setError);
    s2s.on("user_transcript", (text, isFinal) => {
      if (isFinal && text.trim()) setTranscript(text.trim());
    });
    s2s.on("agent_transcript_done", (text) => {
      if (text.trim()) setAgentTranscript(text.trim());
    });
    s2s.on("voice_to_voice", setVoiceToVoiceMs);
    s2s.on("tool_start", ({ name }) => setToolsRunning((n) => [...n, name]));
    s2s.on("tool_end", ({ name }) =>
      setToolsRunning((n) => {
        const i = n.indexOf(name);
        return i === -1 ? n : [...n.slice(0, i), ...n.slice(i + 1)];
      }),
    );
    s2s.on("disconnected", () => {
      setEnabled(false);
      setToolsRunning([]);
    });

    try {
      await s2s.start();
      setEnabled(true);
    } catch (err) {
      s2s.removeAllListeners();
      sessionRef.current = null;
      setSession(null);
      setError(err instanceof Error ? err : new Error(String(err)));
      setState("idle");
      setEnabled(false);
    } finally {
      startingRef.current = false;
    }
  }, []);

  const stop = useCallback(async () => {
    const s2s = sessionRef.current;
    if (!s2s) return;
    sessionRef.current = null;
    await s2s.stop();
    s2s.removeAllListeners();
    setSession(null);
    setState("idle");
    setEnabled(false);
    setToolsRunning([]);
  }, []);

  const interrupt = useCallback(() => sessionRef.current?.interrupt(), []);
  const relay = useCallback((text: string) => sessionRef.current?.relay(text), []);
  const observe = useCallback((text: string) => sessionRef.current?.observe(text), []);

  return {
    state,
    enabled,
    isConnected: state !== "idle" && state !== "connecting",
    error,
    transcript,
    agentTranscript,
    voiceToVoiceMs,
    toolsRunning,
    start,
    stop,
    interrupt,
    relay,
    observe,
    session,
  };
}
