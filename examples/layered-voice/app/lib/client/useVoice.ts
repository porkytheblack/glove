"use client";

// Full-duplex voice controller (ElevenLabs), driven à la carte because the
// agents live server-side (so `useGloveVoice({ runnable })` doesn't fit — it
// assumes an in-browser agent, and can't speak the proactive relay that arrives
// outside the initiating turn).
//
// Mic → VAD → ElevenLabs Scribe (STT) → send as the selected speaker.
// Nova's `say` events (over SSE) → ElevenLabs TTS → speaker, serialized.
// Speaking while Nova talks = barge-in (stop TTS, count it). Every timing is
// measured and shipped to /api/metrics for the local file + the live HUD.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioCapture,
  AudioPlayer,
  VAD,
  ElevenLabsSTTAdapter,
  ElevenLabsTTSAdapter,
} from "glove-voice";
import type { MetricRecord, SpeakerRole } from "../shared/types";

const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

async function fetchToken(path: string): Promise<string> {
  const res = await fetch(path);
  const data = await res.json();
  if (!data?.token) throw new Error(data?.error || `no voice token from ${path}`);
  return data.token as string;
}

export interface UseVoiceArgs {
  sessionId: string | null;
  /** Called when the mic produces a final transcript. */
  onUtterance: (speaker: SpeakerRole, text: string) => void;
  /** The speaker currently "at the mic". */
  getSpeaker: () => SpeakerRole;
  /** Receives every client-measured metric (for the HUD). */
  onMetric?: (m: MetricRecord) => void;
}

export interface VoiceState {
  enabled: boolean;
  ready: boolean;
  listening: boolean;
  speaking: boolean;
  partial: string;
  error: string | null;
  interruptions: number;
}

const INITIAL: VoiceState = {
  enabled: false,
  ready: false,
  listening: false,
  speaking: false,
  partial: "",
  error: null,
  interruptions: 0,
};

export function useVoice(args: UseVoiceArgs) {
  const [state, setState] = useState<VoiceState>(INITIAL);
  const argsRef = useRef(args);
  argsRef.current = args;

  // Audio objects live outside React render.
  const captureRef = useRef<AudioCapture | null>(null);
  const sttRef = useRef<ElevenLabsSTTAdapter | null>(null);
  const vadRef = useRef<VAD | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const currentTTSRef = useRef<ElevenLabsTTSAdapter | null>(null);

  // Mutable flags read from audio-event handlers.
  const enabledRef = useRef(false);
  const gateOpenRef = useRef(false); // feed mic audio to STT?
  const speakingRef = useRef(false); // Nova TTS playing?
  const pendingSaysRef = useRef(0);
  const speakGenRef = useRef(0); // bumped on barge-in / disable to void queued says
  const ttsChainRef = useRef<Promise<void>>(Promise.resolve());
  const cancelCurrentRef = useRef<(() => void) | null>(null);

  // Timing bookkeeping.
  const speechEndAtRef = useRef(0);
  const novaSpeakStartRef = useRef(0);
  const ttfaPendingRef = useRef<{ at: number } | null>(null);

  const patch = useCallback((p: Partial<VoiceState>) => setState((s) => ({ ...s, ...p })), []);

  const emitMetric = useCallback(
    (name: string, ms?: number, data?: Record<string, unknown>) => {
      const rec: MetricRecord = {
        ts: new Date().toISOString(),
        sessionId: argsRef.current.sessionId ?? "unknown",
        source: "client",
        name,
        ...(ms != null ? { ms: Math.round(ms) } : {}),
        ...(data ? { data } : {}),
      };
      argsRef.current.onMetric?.(rec);
      fetch("/api/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec),
      }).catch(() => {});
    },
    [],
  );

  /** Start the TTFA clock: next Nova audio chunk is timed from here. */
  const markUtteranceSent = useCallback(() => {
    ttfaPendingRef.current = { at: Date.now() };
  }, []);

  const beginSpeaking = useCallback(() => {
    gateOpenRef.current = false; // stop feeding STT so Nova isn't transcribed
    speakingRef.current = true;
    novaSpeakStartRef.current = Date.now();
    patch({ speaking: true, listening: false });
  }, [patch]);

  const endSpeaking = useCallback(() => {
    speakingRef.current = false;
    if (enabledRef.current) gateOpenRef.current = true;
    patch({ speaking: false, listening: enabledRef.current });
  }, [patch]);

  const synthAndPlay = useCallback(
    (sayId: string, text: string, gen: number) =>
      new Promise<void>((resolve) => {
        const player = playerRef.current;
        if (!player || gen !== speakGenRef.current || !enabledRef.current) {
          resolve();
          return;
        }
        const tts = new ElevenLabsTTSAdapter({
          getToken: () => fetchToken("/api/voice/tts-token"),
          voiceId: VOICE_ID,
        });
        currentTTSRef.current = tts;

        let firstChunkAt = 0;
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          try {
            tts.destroy();
          } catch {
            /* already gone */
          }
          if (currentTTSRef.current === tts) currentTTSRef.current = null;
          // Serialized playback: this is the only in-flight say, so clearing is safe.
          cancelCurrentRef.current = null;
          resolve();
        };
        cancelCurrentRef.current = () => {
          player.stop();
          settle();
        };

        const t0 = Date.now();
        tts.on("audio_chunk", (pcm) => {
          if (settled) return;
          if (!firstChunkAt) {
            firstChunkAt = Date.now();
            emitMetric("tts_synth_ms", firstChunkAt - t0, { sayId });
            if (ttfaPendingRef.current) {
              emitMetric("time_to_first_audio_ms", firstChunkAt - ttfaPendingRef.current.at, { sayId });
              ttfaPendingRef.current = null;
            }
          }
          player.enqueue(pcm);
        });
        tts.on("done", () => {
          player.onDrained(() => {
            if (firstChunkAt) emitMetric("tts_playback_ms", Date.now() - firstChunkAt, { sayId });
            settle();
          });
        });
        tts.on("error", (e) => {
          patch({ error: e.message });
          settle();
        });

        tts
          .open()
          .then(() => {
            if (settled) return;
            tts.sendText(text);
            tts.flush();
          })
          .catch((e) => {
            patch({ error: (e as Error)?.message ?? "tts failed" });
            settle();
          });
      }),
    [emitMetric, patch],
  );

  /** Queue one of Nova's lines for speech (called on each `say` event). */
  const speak = useCallback(
    (sayId: string, text: string) => {
      if (!enabledRef.current || !text.trim()) return;
      const gen = speakGenRef.current;
      pendingSaysRef.current += 1;
      if (pendingSaysRef.current === 1) beginSpeaking();
      ttsChainRef.current = ttsChainRef.current.then(async () => {
        try {
          if (gen === speakGenRef.current && enabledRef.current) {
            await synthAndPlay(sayId, text, gen);
          }
        } finally {
          pendingSaysRef.current = Math.max(0, pendingSaysRef.current - 1);
          if (pendingSaysRef.current === 0) endSpeaking();
        }
      });
    },
    [beginSpeaking, endSpeaking, synthAndPlay],
  );

  const cleanup = useCallback(async () => {
    try {
      await captureRef.current?.destroy();
    } catch {
      /* ignore */
    }
    try {
      sttRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      vadRef.current?.reset();
    } catch {
      /* ignore */
    }
    try {
      await playerRef.current?.destroy();
    } catch {
      /* ignore */
    }
    captureRef.current = null;
    sttRef.current = null;
    vadRef.current = null;
    playerRef.current = null;
    currentTTSRef.current = null;
    speakingRef.current = false;
    gateOpenRef.current = false;
    pendingSaysRef.current = 0;
  }, []);

  const enable = useCallback(async () => {
    if (enabledRef.current) return;
    patch({ enabled: true, error: null });
    try {
      const player = new AudioPlayer(16_000);
      await player.init();
      playerRef.current = player;

      const capture = new AudioCapture(16_000);
      const vad = new VAD({ minSpeechMs: 150, silenceMs: 700 });
      const stt = new ElevenLabsSTTAdapter({ getToken: () => fetchToken("/api/voice/stt-token") });
      captureRef.current = capture;
      vadRef.current = vad;
      sttRef.current = stt;

      stt.on("partial", (t) => patch({ partial: t }));
      stt.on("final", (t) => {
        const text = t.trim();
        patch({ partial: "" });
        if (!text) return;
        if (speechEndAtRef.current) {
          emitMetric("stt_final_ms", Date.now() - speechEndAtRef.current, { chars: text.length });
        }
        markUtteranceSent();
        argsRef.current.onUtterance(argsRef.current.getSpeaker(), text);
      });
      stt.on("error", (e) => patch({ error: e.message }));

      vad.on("speech_start", () => {
        if (speakingRef.current) {
          // barge-in: the user talks over Nova
          const spokenMs = Date.now() - novaSpeakStartRef.current;
          speakGenRef.current += 1; // void any queued says
          cancelCurrentRef.current?.();
          gateOpenRef.current = true; // route this utterance to STT
          emitMetric("barge_in", spokenMs);
          setState((s) => ({ ...s, interruptions: s.interruptions + 1, speaking: false, listening: true }));
        }
      });
      vad.on("speech_end", () => {
        speechEndAtRef.current = Date.now();
        if (gateOpenRef.current) sttRef.current?.flushUtterance();
      });

      capture.on("chunk", (pcm) => {
        vad.process(pcm);
        if (gateOpenRef.current) stt.sendAudio(pcm);
      });
      capture.on("error", (e) => patch({ error: e.message }));

      await stt.connect();
      await capture.init();

      gateOpenRef.current = true;
      enabledRef.current = true;
      emitMetric("mic_open");
      patch({ ready: true, listening: true });
    } catch (err) {
      patch({ enabled: false, ready: false, error: (err as Error)?.message ?? "voice failed to start" });
      await cleanup();
    }
  }, [cleanup, emitMetric, markUtteranceSent, patch]);

  const disable = useCallback(async () => {
    if (!enabledRef.current) return;
    enabledRef.current = false;
    speakGenRef.current += 1;
    cancelCurrentRef.current?.();
    emitMetric("mic_close");
    await cleanup();
    setState({ ...INITIAL });
  }, [cleanup, emitMetric]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      enabledRef.current = false;
      speakGenRef.current += 1;
      void cleanup();
    };
  }, [cleanup]);

  return { ...state, enable, disable, speak, markUtteranceSent };
}
