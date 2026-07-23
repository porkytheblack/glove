"use client";

// Full-duplex voice controller (ElevenLabs), driven à la carte because the
// agents live server-side (so `useGloveVoice({ runnable })` doesn't fit — it
// assumes an in-browser agent, and can't speak the proactive relay that arrives
// outside the initiating turn).
//
// Mic → VAD → ElevenLabs Scribe (STT) → send as the selected speaker.
// Nova's parsed <speech> tokens stream into ElevenLabs input-streaming TTS —
// audio starts on the first spoken token.
//
// SPEECH TURNS ARE QUEUED (the paper's §5 audio-state rule): the server may
// finish generating a relay while the previous turn's audio is still playing,
// so each spoken turn is an entry in a queue and the next turn's audio does NOT
// start until (a) the current turn has fully drained from the speaker and
// (b) the user isn't mid-utterance (their turn takes priority). The relay's
// MODEL work still pipelines server-side — only the audio waits. Barge-in
// voids the current turn AND everything queued behind it.
//
// Every timing is measured and shipped to /api/metrics (local JSONL + HUD).

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
  /**
   * A barge-in cut Nova's audio. `heardText` is the estimated prefix that
   * actually played before the cut (empty = nothing played yet). Report it to
   * the server so a <user-interruption> notice lands in her history.
   */
  onInterruption?: (heardText: string, playedMs: number) => void;
  /** A spoken turn's TTS failed — the room never heard the line. */
  onSpeechFailure?: (detail: string) => void;
}

// Rough ElevenLabs speaking rate, used to estimate how much of the sent text
// had actually played when a barge-in cut the audio. Approximate by design —
// the notice is phrased as "heard only about this much".
const TTS_CHARS_PER_SEC = 15;

function estimateHeard(sentText: string, playedMs: number): string {
  if (!sentText || playedMs <= 0) return "";
  const n = Math.min(sentText.length, Math.round((playedMs / 1000) * TTS_CHARS_PER_SEC));
  if (n >= sentText.length) return sentText.trim();
  const cut = sentText.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
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

/** One spoken turn's lifecycle: buffered → active (synthesizing/playing) → done. */
interface SpeechTurn {
  id: number;
  /** Text waiting to be sent (turn not started yet), with per-chunk flush flags. */
  pending: Array<{ text: string; flush?: boolean }>;
  /** Everything handed to this turn's TTS so far (for heard-prefix estimation). */
  sentText: string;
  /** The one-time ~60-char forced-generation trigger has fired. */
  earlyFlushSent: boolean;
  /** Chars sent since the last forced-generation flush (throttles triggers). */
  charsSinceFlush: number;
  tts: ElevenLabsTTSAdapter | null;
  /** endTurn was called — no more text is coming for this turn. */
  flushed: boolean;
  /** Watchdog: fails the turn if ElevenLabs goes silent (no audio frames). */
  stallTimer: ReturnType<typeof setTimeout> | null;
  enqueuedAt: number;
  startedAt: number;
  firstChunkAt: number;
}

/** Chars buffered before the first forced-generation flush. */
const EARLY_FLUSH_CHARS = 60;
/**
 * Min chars between subsequent forced flushes. Without this, a long turn fired
 * a flush on nearly every sentence (~6 generations per turn), fragmenting
 * prosody and apparently upsetting ElevenLabs' finalization on long streams.
 */
const MIN_FLUSH_GAP_CHARS = 120;
/** Max ms with no audio frame on an active turn before we close it out. */
const STALL_MS = 12_000;

export function useVoice(args: UseVoiceArgs) {
  const [state, setState] = useState<VoiceState>(INITIAL);
  const argsRef = useRef(args);
  argsRef.current = args;

  // Audio objects live outside React render.
  const captureRef = useRef<AudioCapture | null>(null);
  const sttRef = useRef<ElevenLabsSTTAdapter | null>(null);
  const vadRef = useRef<VAD | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // Speech-turn queue (§5 audio gate).
  const queueRef = useRef<SpeechTurn[]>([]);
  const activeRef = useRef<SpeechTurn | null>(null);
  const turnSeq = useRef(0);
  // A TTS WebSocket opened WHILE the model is thinking (utterance sent → first
  // token), so the token-mint + handshake cost overlaps model latency instead
  // of adding to time-to-first-audio. Adopted by the next spoken turn — even
  // while STILL OPENING (text queues into it; never pay the handshake twice).
  const prewarmRef = useRef<{ tts: ElevenLabsTTSAdapter; at: number; opening: Promise<void> } | null>(null);

  // Mutable flags read from audio-event handlers.
  const enabledRef = useRef(false);
  const gateOpenRef = useRef(false); // feed mic audio to STT?
  const speakingRef = useRef(false); // Nova audio playing?
  const userSpeakingRef = useRef(false); // VAD says a human is talking

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

  const makeTts = useCallback(
    () =>
      new ElevenLabsTTSAdapter({
        getToken: () => fetchToken("/api/voice/tts-token"),
        voiceId: VOICE_ID,
        // Realtime: synthesize after ~60 buffered chars (mid-sentence) instead
        // of the default ~120+. Sentence-boundary triggering (auto_mode) was
        // self-defeating for one-sentence replies — the first sentence only
        // completes when the whole reply is done. Raw token streaming + a low
        // schedule starts audio well before the text finishes.
        generationConfig: { chunkLengthSchedule: [60, 120, 160, 250] },
      }),
    [],
  );

  /** Open a TTS socket ahead of time so the handshake overlaps model latency. */
  const prewarm = useCallback(() => {
    if (!enabledRef.current) return;
    const existing = prewarmRef.current;
    if (existing && Date.now() - existing.at < 15_000) return; // still fresh
    if (existing) {
      try {
        existing.tts.destroy();
      } catch {
        /* already gone */
      }
    }
    const tts = makeTts();
    const entry = { tts, at: Date.now(), opening: tts.open() };
    prewarmRef.current = entry;
    entry.opening.catch(() => {
      if (prewarmRef.current === entry) prewarmRef.current = null;
    });
  }, [makeTts]);

  /** Start the time-to-first-audio clock; next Nova audio chunk is timed from here. */
  const markUtteranceSent = useCallback(() => {
    ttfaPendingRef.current = { at: Date.now() };
    prewarm();
  }, [prewarm]);

  const newTurn = useCallback(
    (flushed = false): SpeechTurn => ({
      id: ++turnSeq.current,
      pending: [],
      sentText: "",
      earlyFlushSent: false,
      charsSinceFlush: 0,
      tts: null,
      flushed,
      stallTimer: null,
      enqueuedAt: Date.now(),
      startedAt: 0,
      firstChunkAt: 0,
    }),
    [],
  );

  /**
   * Route one streamed chunk to the turn: live if active, else buffered.
   * Forced-generation (`flush: true`) triggers make synthesis start
   * mid-generation DETERMINISTICALLY — once at ~60 buffered chars, then at
   * each sentence-ending punctuation — regardless of ElevenLabs' server-side
   * buffering policy.
   */
  const deliver = useCallback((turn: SpeechTurn, text: string) => {
    if (!text) return;
    const already = turn.sentText.length + turn.pending.reduce((n, p) => n + p.text.length, 0);
    turn.charsSinceFlush += text.length;
    let flush = false;
    if (!turn.earlyFlushSent && already + text.length >= EARLY_FLUSH_CHARS) {
      turn.earlyFlushSent = true;
      flush = true;
    } else if (turn.earlyFlushSent && /[.?!]/.test(text) && turn.charsSinceFlush >= MIN_FLUSH_GAP_CHARS) {
      flush = true;
    }
    if (flush) turn.charsSinceFlush = 0;
    if (turn === activeRef.current && turn.tts) {
      turn.tts.sendText(text, flush ? { flush: true } : undefined);
      turn.sentText += text;
    } else {
      turn.pending.push({ text, flush });
    }
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

  /** The writing turn: where new deltas belong (active if still open, else queue tail). */
  const writingTurn = useCallback((): SpeechTurn | null => {
    const active = activeRef.current;
    if (active && !active.flushed) return active;
    const tail = queueRef.current[queueRef.current.length - 1];
    if (tail && !tail.flushed) return tail;
    return null;
  }, []);

  const completeActive = useCallback(
    (turn: SpeechTurn) => {
      if (activeRef.current !== turn) return;
      if (turn.stallTimer) {
        clearTimeout(turn.stallTimer);
        turn.stallTimer = null;
      }
      activeRef.current = null;
      try {
        turn.tts?.destroy();
      } catch {
        /* already gone */
      }
      // Hold the "speaking" state if another turn is about to play.
      if (queueRef.current.length === 0 || userSpeakingRef.current) endSpeaking();
      maybeStartNextRef.current();
    },
    [endSpeaking],
  );

  /**
   * Watchdog: (re)armed at turn start and on every audio frame. If ElevenLabs
   * goes silent past STALL_MS, fail the turn instead of holding the §5 audio
   * gate until ElevenLabs' own ~20s inactivity timeout (or forever).
   */
  const armStall = useCallback(
    (turn: SpeechTurn) => {
      if (turn.stallTimer) clearTimeout(turn.stallTimer);
      turn.stallTimer = setTimeout(() => {
        if (activeRef.current !== turn) return;
        // If the turn was flushed and audio flowed, the room almost certainly
        // heard the line and only the FINALIZATION went missing (isFinal /
        // drain never fired). Close it out quietly — a false <speech-failure>
        // notice here made Nova needlessly repeat herself.
        const assumedComplete = turn.flushed && turn.firstChunkAt > 0;
        emitMetric("tts_stall", STALL_MS, {
          turn: turn.id,
          sentChars: turn.sentText.length,
          hadAudio: turn.firstChunkAt > 0,
          assumedComplete,
        });
        if (!assumedComplete) {
          patch({ error: "TTS stalled — no audio from ElevenLabs; turn abandoned" });
          argsRef.current.onSpeechFailure?.("TTS stalled — no audio frames");
        }
        completeActive(turn);
      }, STALL_MS);
    },
    [completeActive, emitMetric, patch],
  );

  /**
   * The §5 gate: start the next queued turn's audio only when nothing is
   * playing AND the user isn't mid-utterance.
   */
  const maybeStartNext = useCallback(() => {
    if (!enabledRef.current) return;
    if (activeRef.current) return; // current audio not drained yet
    if (userSpeakingRef.current) return; // user's turn takes priority
    const next = queueRef.current.shift();
    if (!next) return;

    const player = playerRef.current;
    if (!player) return;

    activeRef.current = next;
    next.startedAt = Date.now();
    emitMetric("speech_queue_wait_ms", next.startedAt - next.enqueuedAt, { turn: next.id });
    beginSpeaking();

    // Adopt the prewarmed socket if it's fresh — even if the handshake is
    // still in flight (text queues into it; never pay the handshake twice).
    let tts: ElevenLabsTTSAdapter | null = null;
    let opening: Promise<void> | null = null;
    let adopted = false;
    const pw = prewarmRef.current;
    prewarmRef.current = null;
    if (pw) {
      if (Date.now() - pw.at < 15_000) {
        tts = pw.tts;
        opening = pw.opening;
        adopted = true;
      } else {
        try {
          pw.tts.destroy();
        } catch {
          /* already gone */
        }
      }
    }
    if (!tts) tts = makeTts();
    next.tts = tts;

    tts.on("audio_chunk", (pcm) => {
      if (activeRef.current !== next) return; // superseded by barge-in
      armStall(next); // frames flowing — push the watchdog out
      if (!next.firstChunkAt) {
        next.firstChunkAt = Date.now();
        emitMetric("tts_synth_ms", next.firstChunkAt - next.startedAt, { turn: next.id });
        if (ttfaPendingRef.current) {
          emitMetric("time_to_first_audio_ms", next.firstChunkAt - ttfaPendingRef.current.at, { turn: next.id });
          ttfaPendingRef.current = null;
        }
      }
      player.enqueue(pcm);
    });
    tts.on("done", () => {
      player.onDrained(() => {
        if (activeRef.current !== next) return;
        if (next.firstChunkAt) emitMetric("tts_playback_ms", Date.now() - next.firstChunkAt, { turn: next.id });
        completeActive(next);
      });
    });
    tts.on("error", (e) => {
      patch({ error: e.message });
      if (!next.firstChunkAt) argsRef.current.onSpeechFailure?.(e.message);
      completeActive(next);
    });

    // Adapter queues text sent before open() resolves.
    for (const msg of next.pending) {
      tts.sendText(msg.text, msg.flush ? { flush: true } : undefined);
      next.sentText += msg.text;
    }
    next.pending = [];
    armStall(next);

    // One path for both cases: adopted sockets carry their in-flight open
    // promise; cold sockets open now. Adopted + already-ready resolves at ~0ms.
    const t = tts;
    (opening ?? t.open())
      .then(() => {
        emitMetric("tts_stream_open_ms", Date.now() - next.startedAt, { turn: next.id, adopted });
        if (activeRef.current === next && next.flushed) t.flush();
      })
      .catch((e) => {
        const msg = (e as Error)?.message ?? "tts failed";
        patch({ error: msg });
        argsRef.current.onSpeechFailure?.(msg);
        completeActive(next);
      });
  }, [armStall, beginSpeaking, completeActive, emitMetric, makeTts, patch]);
  const maybeStartNextRef = useRef(maybeStartNext);
  maybeStartNextRef.current = maybeStartNext;

  /**
   * Feed one of Nova's streamed spoken tokens straight into the right turn —
   * raw, as it arrives. ElevenLabs buffers by the low chunk_length_schedule
   * and starts synthesizing after ~60 chars, mid-sentence, mid-generation.
   */
  const feedDelta = useCallback(
    (text: string) => {
      if (!enabledRef.current || !text) return;
      let writing = writingTurn();
      if (!writing) {
        writing = newTurn();
        queueRef.current.push(writing);
        maybeStartNext();
      }
      deliver(writing, text);
    },
    [deliver, maybeStartNext, newTurn, writingTurn],
  );

  /** End of a Nova turn: no more text. Falls back to speaking the whole line if
   *  nothing was streamed (non-streaming model). */
  const endTurn = useCallback(
    (fallbackText?: string) => {
      if (!enabledRef.current) return;
      const writing = writingTurn();
      if (writing) {
        writing.flushed = true;
        if (writing === activeRef.current && writing.tts?.isReady) writing.tts.flush();
        // If not open yet, the open() handler flushes (flushed is set).
        return;
      }
      if (fallbackText && fallbackText.trim()) {
        const turn = newTurn(true);
        turn.pending.push({ text: fallbackText });
        queueRef.current.push(turn);
        maybeStartNext();
      }
    },
    [maybeStartNext, newTurn, writingTurn],
  );

  /** Kill current audio AND everything queued (barge-in / disable). */
  const stopSpeaking = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    queueRef.current = [];
    playerRef.current?.stop();
    if (active?.stallTimer) {
      clearTimeout(active.stallTimer);
      active.stallTimer = null;
    }
    if (active?.tts) {
      try {
        active.tts.destroy();
      } catch {
        /* already gone */
      }
    }
  }, []);

  const cleanup = useCallback(async () => {
    stopSpeaking();
    if (prewarmRef.current) {
      try {
        prewarmRef.current.tts.destroy();
      } catch {
        /* already gone */
      }
      prewarmRef.current = null;
    }
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
    userSpeakingRef.current = false;
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
        // Only measure against a FRESH speech_end. Scribe can auto-commit
        // accumulated audio long after the last VAD boundary (e.g. echo /
        // noise-floor drift keeps VAD "speaking") — measuring those against a
        // stale timestamp produced garbage like stt_final_ms=142s.
        const endAt = speechEndAtRef.current;
        speechEndAtRef.current = 0;
        if (endAt && Date.now() - endAt < 10_000) {
          emitMetric("stt_final_ms", Date.now() - endAt, { chars: text.length });
        }
        markUtteranceSent();
        argsRef.current.onUtterance(argsRef.current.getSpeaker(), text);
      });
      stt.on("error", (e) => patch({ error: e.message }));

      vad.on("speech_start", () => {
        userSpeakingRef.current = true;
        // The user started talking → an utterance (and likely a Nova reply)
        // is coming. Open the TTS socket now, overlapping STT + model time.
        prewarm();
        if (speakingRef.current) {
          // barge-in: the user talks over Nova — void current + queued speech.
          // Estimate how much of the active turn actually played BEFORE
          // tearing it down, so the model can be told where it was cut.
          const active = activeRef.current;
          const playedMs = active?.firstChunkAt ? Date.now() - active.firstChunkAt : 0;
          const heard = active ? estimateHeard(active.sentText, playedMs) : "";
          const spokenMs = Date.now() - novaSpeakStartRef.current;
          const dropped = queueRef.current.length;
          stopSpeaking();
          speakingRef.current = false;
          gateOpenRef.current = true; // route this utterance to STT
          emitMetric("barge_in", spokenMs, { droppedQueuedTurns: dropped, heardChars: heard.length });
          argsRef.current.onInterruption?.(heard, playedMs);
          setState((s) => ({ ...s, interruptions: s.interruptions + 1, speaking: false, listening: true }));
        }
      });
      vad.on("speech_end", () => {
        userSpeakingRef.current = false;
        speechEndAtRef.current = Date.now();
        if (gateOpenRef.current) sttRef.current?.flushUtterance();
        // A relay held back by the user's speech can play now (§5).
        maybeStartNextRef.current();
      });

      capture.on("chunk", (pcm) => {
        vad.process(pcm);
        if (gateOpenRef.current) stt.sendAudio(pcm);
      });
      capture.on("error", (e) => patch({ error: e.message }));

      await stt.connect();
      await capture.init();
      prewarm(); // first turn shouldn't pay a cold open either

      gateOpenRef.current = true;
      enabledRef.current = true;
      emitMetric("mic_open");
      patch({ ready: true, listening: true });
    } catch (err) {
      patch({ enabled: false, ready: false, error: (err as Error)?.message ?? "voice failed to start" });
      await cleanup();
    }
  }, [cleanup, emitMetric, markUtteranceSent, patch, prewarm, stopSpeaking]);

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

  return { ...state, enable, disable, feedDelta, endTurn, markUtteranceSent, prewarm };
}
