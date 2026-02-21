"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { GloveVoice, type GloveVoiceConfig, type VoiceMode } from "glove-voice";
import type { IGloveRunnable } from "glove-core/glove";

// ─── Config & return types ───────────────────────────────────────────────────

export interface UseGloveVoiceConfig {
  /** The Glove runnable instance — pass `useGlove().runnable`. */
  runnable: IGloveRunnable | null;
  /** Voice pipeline config (STT adapter, TTS factory, turn mode, etc.) */
  voice: GloveVoiceConfig;
}

export interface UseGloveVoiceReturn {
  /** Current voice pipeline state: idle → listening → thinking → speaking */
  mode: VoiceMode;
  /** Current partial transcript while user is speaking */
  transcript: string;
  /** Whether the voice pipeline is active (not idle) */
  isActive: boolean;
  /** Last error from the voice pipeline (cleared on next start) */
  error: Error | null;
  /** Start the voice pipeline — requests mic permission, opens STT */
  start: () => Promise<void>;
  /** Stop the voice pipeline and release all resources */
  stop: () => Promise<void>;
  /** Interrupt current response (barge-in). Auto-returns to listening. */
  interrupt: () => void;
  /** Manual turn commit — flush current utterance to STT (push-to-talk) */
  commitTurn: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * React hook for managing a GloveVoice pipeline.
 *
 * Creates and manages a `GloveVoice` instance lazily — the mic is only
 * requested when `start()` is called, not on mount.
 *
 * @example VAD mode (hands-free)
 * ```tsx
 * const { runnable } = useGlove({ endpoint: "/api/chat", systemPrompt, tools });
 * const { stt, createTTS } = createElevenLabsAdapters({ ... });
 *
 * const voice = useGloveVoice({
 *   runnable,
 *   voice: { stt, createTTS },
 * });
 *
 * <button onClick={voice.isActive ? voice.stop : voice.start}>
 *   {voice.mode}
 * </button>
 * ```
 *
 * @example Manual mode (push-to-talk)
 * ```tsx
 * const voice = useGloveVoice({
 *   runnable,
 *   voice: { stt, createTTS, turnMode: "manual" },
 * });
 *
 * <button
 *   onPointerDown={voice.start}
 *   onPointerUp={voice.commitTurn}
 * />
 * ```
 */
export function useGloveVoice(config: UseGloveVoiceConfig): UseGloveVoiceReturn {
  const { runnable, voice: voiceConfig } = config;

  const [mode, setMode] = useState<VoiceMode>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<Error | null>(null);

  const voiceRef = useRef<GloveVoice | null>(null);

  // Tear down on unmount or when runnable changes
  useEffect(() => {
    return () => {
      const v = voiceRef.current;
      if (v?.isActive) {
        void v.stop();
      }
      voiceRef.current = null;
    };
  }, [runnable]);

  const start = useCallback(async () => {
    if (!runnable) {
      throw new Error("useGloveVoice: runnable is not ready yet");
    }
    if (voiceRef.current?.isActive) return;

    setError(null);
    setTranscript("");

    const voice = new GloveVoice(runnable, voiceConfig);
    voiceRef.current = voice;

    voice.on("mode", (m: VoiceMode) => setMode(m));
    voice.on("transcript", (text: string, partial: boolean) => {
      if (partial) setTranscript(text);
    });
    voice.on("error", (err: Error) => setError(err));

    try {
      await voice.start();
    } catch (err) {
      voiceRef.current = null;
      setError(err instanceof Error ? err : new Error(String(err)));
      setMode("idle");
    }
  }, [runnable, voiceConfig]);

  const stop = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice) return;

    await voice.stop();
    voice.removeAllListeners();
    voiceRef.current = null;
    setMode("idle");
    setTranscript("");
  }, []);

  const interrupt = useCallback(() => {
    voiceRef.current?.interrupt();
  }, []);

  const commitTurn = useCallback(() => {
    voiceRef.current?.commitTurn();
  }, []);

  return {
    mode,
    transcript,
    isActive: mode !== "idle",
    error,
    start,
    stop,
    interrupt,
    commitTurn,
  };
}
