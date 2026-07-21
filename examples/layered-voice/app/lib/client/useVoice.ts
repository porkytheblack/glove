"use client";

// Full-duplex voice controller (ElevenLabs), driven à la carte because the
// agents live server-side (so `useGloveVoice({ runnable })` doesn't fit — it
// assumes an in-browser agent, and can't speak the proactive relay that arrives
// outside the initiating turn).
//
// Mic → VAD → ElevenLabs Scribe (STT) → send as the selected speaker.
// Nova's text is spoken with STREAMING TTS: each `delta` token is fed straight
// into an open ElevenLabs input-streaming session, so audio starts on the first
// token — no waiting for the finished line. `say` just flushes the turn.
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

interface TtsTurn {
  tts: ElevenLabsTTSAdapter;
  openedAt: number;
  firstChunkAt: number;
}

export function useVoice(args: UseVoiceArgs) {
  const [state, setState] = useState<VoiceState>(INITIAL);
  const argsRef = useRef(args);
  argsRef.current = args;

  // Audio objects live outside React render.
  const captureRef = useRef<AudioCapture | null>(null);
  const sttRef = useRef<ElevenLabsSTTAdapter | null>(null);
  const vadRef = useRef<VAD | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const turnRef = useRef<TtsTurn | null>(null); // the open streaming TTS turn

  // Mutable flags read from audio-event handlers.
  const enabledRef = useRef(false);
  const gateOpenRef = useRef(false); // feed mic audio to STT?
  const speakingRef = useRef(false);

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

  /** Start the time-to-first-audio clock; next Nova audio chunk is timed from here. */
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

  const finishTurn = useCallback(
    (turn: TtsTurn) => {
      try {
        turn.tts.destroy();
      } catch {
        /* already gone */
      }
      if (turnRef.current === turn) {
        turnRef.current = null;
        endSpeaking();
      }
    },
    [endSpeaking],
  );

  /** Open a streaming TTS turn. Text can be sent immediately (adapter queues). */
  const openTurn = useCallback((): TtsTurn | null => {
    const player = playerRef.current;
    if (!player || !enabledRef.current) return null;
    const tts = new ElevenLabsTTSAdapter({
      getToken: () => fetchToken("/api/voice/tts-token"),
      voiceId: VOICE_ID,
    });
    const turn: TtsTurn = { tts, openedAt: Date.now(), firstChunkAt: 0 };
    turnRef.current = turn;
    beginSpeaking();

    tts.on("audio_chunk", (pcm) => {
      if (turnRef.current !== turn) return; // superseded by barge-in
      if (!turn.firstChunkAt) {
        turn.firstChunkAt = Date.now();
        emitMetric("tts_synth_ms", turn.firstChunkAt - turn.openedAt);
        if (ttfaPendingRef.current) {
          emitMetric("time_to_first_audio_ms", turn.firstChunkAt - ttfaPendingRef.current.at);
          ttfaPendingRef.current = null;
        }
      }
      player.enqueue(pcm);
    });
    tts.on("done", () => {
      player.onDrained(() => {
        if (turnRef.current === turn) {
          if (turn.firstChunkAt) emitMetric("tts_playback_ms", Date.now() - turn.firstChunkAt);
          finishTurn(turn);
        }
      });
    });
    tts.on("error", (e) => {
      patch({ error: e.message });
      finishTurn(turn);
    });
    tts.open().catch((e) => {
      patch({ error: (e as Error)?.message ?? "tts failed" });
      finishTurn(turn);
    });
    return turn;
  }, [beginSpeaking, emitMetric, finishTurn, patch]);

  /** Feed one of Nova's streamed tokens straight into the open TTS turn. */
  const feedDelta = useCallback(
    (text: string) => {
      if (!enabledRef.current || !text) return;
      const turn = turnRef.current ?? openTurn();
      turn?.tts.sendText(text);
    },
    [openTurn],
  );

  /** End of a Nova turn: flush the streamed audio. Falls back to speaking the
   *  whole line if no tokens were streamed (non-streaming model). */
  const endTurn = useCallback(
    (fallbackText?: string) => {
      if (!enabledRef.current) return;
      if (turnRef.current) {
        turnRef.current.tts.flush();
      } else if (fallbackText && fallbackText.trim()) {
        const turn = openTurn();
        if (turn) {
          turn.tts.sendText(fallbackText);
          turn.tts.flush();
        }
      }
    },
    [openTurn],
  );

  const stopSpeaking = useCallback(() => {
    const turn = turnRef.current;
    turnRef.current = null;
    playerRef.current?.stop();
    if (turn) {
      try {
        turn.tts.destroy();
      } catch {
        /* already gone */
      }
    }
  }, []);

  const cleanup = useCallback(async () => {
    stopSpeaking();
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
    speakingRef.current = false;
    gateOpenRef.current = false;
  }, [stopSpeaking]);

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
          stopSpeaking();
          speakingRef.current = false;
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
  }, [cleanup, emitMetric, markUtteranceSent, patch, stopSpeaking]);

  const disable = useCallback(async () => {
    if (!enabledRef.current) return;
    enabledRef.current = false;
    emitMetric("mic_close");
    await cleanup();
    setState({ ...INITIAL });
  }, [cleanup, emitMetric]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      enabledRef.current = false;
      void cleanup();
    };
  }, [cleanup]);

  return { ...state, enable, disable, feedDelta, endTurn, markUtteranceSent };
}
