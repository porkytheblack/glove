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
  HeuristicTurnDetector,
  RemoteTurnDetector,
  VAD,
  type TurnDetectorAdapter,
  type VADAdapter,
  ElevenLabsSTTAdapter,
  ElevenLabsTTSAdapter,
} from "glove-voice";
// NOTE: SileroVADAdapter is loaded with a dynamic import inside enable() —
// onnxruntime-web resolves asset URLs at module-import time, which explodes
// during Next's server prerender of this (client) module graph.
import type { MetricRecord, SpeakerRole } from "../shared/types";

const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || "uYXf8XasLslADfZ2MB4u";
// flash_v2_5 is ElevenLabs' lowest-latency model (~75ms model time vs ~250ms+
// for turbo) — the right trade for a support-desk voice. Override if you want
// turbo's slightly richer delivery.
const TTS_MODEL = process.env.NEXT_PUBLIC_TTS_MODEL || "eleven_flash_v2_5";
// End-of-speech silence window — THE latency floor of the whole send path
// (every ms here is dead air before anything else can even start). 450ms is
// aggressive on its own, so endpointing is TWO-TIER: at the VAD boundary the
// partial transcript is checked — text that reads finished (ends in .?!)
// dispatches immediately; text that sounds mid-thought gets an extra hold so
// a breath or a pause to think doesn't cut the sentence. Resuming speech
// cancels the hold and the utterance keeps growing as one.
const VAD_SILENCE_MS = Number(process.env.NEXT_PUBLIC_VAD_SILENCE_MS) || 450;
// Semantic endpointing (turn detection) — glove-voice's TurnDetectorAdapter
// decides, at each VAD boundary, how much longer to wait before committing
// the utterance. Default: the heuristic tiers. NEXT_PUBLIC_TURN_DETECTOR=
// "smart" routes each decision through /api/turn — the LiveKit
// end-of-utterance model scoring server-side (~25ms) — with the heuristic
// as fallback and as the hold-picker when the model says "not done".
const HEURISTIC_DETECTOR = new HeuristicTurnDetector({
  questionHoldMs: 0,
  statementHoldMs: Number(process.env.NEXT_PUBLIC_ENDPOINT_HOLD_SOFT_MS) || 600,
  unfinishedHoldMs: Number(process.env.NEXT_PUBLIC_ENDPOINT_HOLD_MS) || 900,
  dictationHoldMs: Number(process.env.NEXT_PUBLIC_SPELL_HOLD_MS) || 2000,
});
const TURN_DETECTOR: TurnDetectorAdapter =
  process.env.NEXT_PUBLIC_TURN_DETECTOR === "smart"
    ? new RemoteTurnDetector({
        url: "/api/turn",
        threshold: Number(process.env.NEXT_PUBLIC_TURN_EOU_THRESHOLD) || 0.5,
        fallback: HEURISTIC_DETECTOR,
      })
    : HEURISTIC_DETECTOR;

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
  /** The server-side front-turn id this speech belongs to (from delta events). */
  serverTurnId: number | null;
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
  const vadRef = useRef<VADAdapter | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // Speech-turn queue (§5 audio gate).
  const queueRef = useRef<SpeechTurn[]>([]);
  const activeRef = useRef<SpeechTurn | null>(null);
  const turnSeq = useRef(0);
  // A TTS WebSocket opened WHILE the model is thinking (utterance sent → first
  // token), so the token-mint + handshake cost overlaps model latency instead
  // of adding to time-to-first-audio. Adopted by the next spoken turn — even
  // while STILL OPENING (text queues into it; never pay the handshake twice).
  const prewarmRef = useRef<{
    tts: ElevenLabsTTSAdapter;
    at: number;
    opening: Promise<void>;
    // Idle keepalive: ElevenLabs closes a stream-input socket after ~20s
    // without messages. A slow-thinking front model can easily exceed that
    // between prewarm and first token — the adopted socket then dies mid-turn
    // and the line never plays ("speech failed to play"). A whitespace chunk
    // every 8s keeps it open without triggering generation.
    keepalive: ReturnType<typeof setInterval> | null;
  } | null>(null);

  // Server front-turn ids voided by a barge-in. The server keeps streaming the
  // cut turn's deltas after the audio is killed; without this they'd re-queue
  // as a brand-new speech turn and play the moment the user goes quiet (Nova
  // "resuming" her interrupted line), and the turn-end `say` fallback could
  // re-speak the whole thing. Keyed by the server's own turn id, so it can
  // never leak onto a later turn.
  const voidedTurnsRef = useRef<Set<number>>(new Set());

  // Mutable flags read from audio-event handlers.
  const enabledRef = useRef(false);
  const gateOpenRef = useRef(false); // feed mic audio to STT?
  const speakingRef = useRef(false); // Nova audio playing?
  const userSpeakingRef = useRef(false); // VAD says a human is talking

  // §5-gate stuck-open watchdog. Background noise (a TV, music, someone on a
  // phone nearby) can pin the VAD "speaking" for tens of seconds; queued Nova
  // audio then never starts and voice looks dead. If a turn has been held
  // this long while the "speech" produced no fresh STT partials, we call it
  // noise and force the gate open.
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPartialAtRef = useRef(0);
  // Stable-transcript flush timer (see the stt partial handler).
  const stableFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Text already dispatched from a live partial — Scribe's committed confirm
  // for it must be swallowed, not re-sent as a second utterance.
  const pendingConfirmRef = useRef<string | null>(null);
  // Two-tier endpoint: the extra-hold timer for unfinished-sounding partials.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Idle-buffer sweeper (see enable()) — catches transcript stranded by a
  // speech_end that fired while the gate was closed or a skipped hold.
  const sweepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        model: TTS_MODEL,
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
    // The keepalive holds the socket open indefinitely, but recycle anyway
    // after a while — ElevenLabs may cap total connection lifetime.
    if (existing && Date.now() - existing.at < 60_000) return; // still fresh
    if (existing) {
      if (existing.keepalive) clearInterval(existing.keepalive);
      try {
        existing.tts.destroy();
      } catch {
        /* already gone */
      }
    }
    const tts = makeTts();
    const entry = {
      tts,
      at: Date.now(),
      opening: tts.open(),
      keepalive: null as ReturnType<typeof setInterval> | null,
    };
    prewarmRef.current = entry;
    entry.opening
      .then(() => {
        if (prewarmRef.current !== entry) return; // already adopted/discarded
        entry.keepalive = setInterval(() => {
          try {
            entry.tts.sendText(" ");
          } catch {
            /* socket gone — the adoption check will discard it */
          }
        }, 8_000);
      })
      .catch(() => {
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
      serverTurnId: null,
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
  /** Held-gate watchdog: release after GATE_HOLD_MAX_MS of transcript-less "speech". */
  const armGateWatchdog = useCallback(() => {
    const GATE_HOLD_MAX_MS = 4000;
    const PARTIAL_FRESH_MS = 2500;
    if (gateTimerRef.current || queueRef.current.length === 0) return;
    gateTimerRef.current = setTimeout(() => {
      gateTimerRef.current = null;
      if (!enabledRef.current || activeRef.current) return;
      if (!userSpeakingRef.current || queueRef.current.length === 0) return;
      if (Date.now() - lastPartialAtRef.current < PARTIAL_FRESH_MS) {
        // The transcript is moving — a real person is talking. Keep waiting.
        armGateWatchdogRef.current();
        return;
      }
      emitMetric("gate_force_release", undefined, { queued: queueRef.current.length });
      vadRef.current?.reset();
      userSpeakingRef.current = false;
      maybeStartNextRef.current();
    }, GATE_HOLD_MAX_MS);
  }, [emitMetric]);
  const armGateWatchdogRef = useRef(armGateWatchdog);
  armGateWatchdogRef.current = armGateWatchdog;

  const maybeStartNext = useCallback(() => {
    if (!enabledRef.current) return;
    if (activeRef.current) return; // current audio not drained yet
    if (userSpeakingRef.current) {
      // User's turn takes priority — but don't let noise hold it forever.
      armGateWatchdogRef.current();
      return;
    }
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
      // Stop the idle keepalive BEFORE any real text goes down the socket.
      if (pw.keepalive) clearInterval(pw.keepalive);
      if (Date.now() - pw.at < 60_000) {
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
    (text: string, serverTurnId?: number) => {
      if (!enabledRef.current || !text) return;
      // Tail of a barge-in-voided turn — drop it (matched by the server's id).
      if (serverTurnId != null && voidedTurnsRef.current.has(serverTurnId)) return;
      let writing = writingTurn();
      // A delta from a NEW server turn while an old one is still open means the
      // old turn ended without a `say` (errored / all-silent) — close it out so
      // the new turn gets its own speech entry.
      if (
        writing &&
        serverTurnId != null &&
        writing.serverTurnId != null &&
        writing.serverTurnId !== serverTurnId
      ) {
        writing.flushed = true;
        if (writing === activeRef.current && writing.tts?.isReady) writing.tts.flush();
        writing = null;
      }
      if (!writing) {
        writing = newTurn();
        writing.serverTurnId = serverTurnId ?? null;
        queueRef.current.push(writing);
        maybeStartNext();
      }
      if (writing.serverTurnId == null && serverTurnId != null) writing.serverTurnId = serverTurnId;
      deliver(writing, text);
    },
    [deliver, maybeStartNext, newTurn, writingTurn],
  );

  /** End of a Nova turn: no more text. Falls back to speaking the whole line if
   *  nothing was streamed (non-streaming model). */
  const endTurn = useCallback(
    (fallbackText?: string, serverTurnId?: number) => {
      if (!enabledRef.current) return;
      // The closing `say` of a barge-in-voided turn: never fall back to
      // re-speaking its full text — the room already cut it off, and the
      // <user-interruption> notice covers what was heard.
      if (serverTurnId != null && voidedTurnsRef.current.has(serverTurnId)) return;
      const writing = writingTurn();
      if (writing) {
        writing.flushed = true;
        if (writing === activeRef.current && writing.tts?.isReady) writing.tts.flush();
        // If not open yet, the open() handler flushes (flushed is set).
        return;
      }
      if (fallbackText && fallbackText.trim()) {
        const turn = newTurn(true);
        turn.serverTurnId = serverTurnId ?? null;
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
      if (prewarmRef.current.keepalive) clearInterval(prewarmRef.current.keepalive);
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
    if (gateTimerRef.current) {
      clearTimeout(gateTimerRef.current);
      gateTimerRef.current = null;
    }
    if (stableFlushRef.current) {
      clearTimeout(stableFlushRef.current);
      stableFlushRef.current = null;
    }
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (sweepTimerRef.current) {
      clearInterval(sweepTimerRef.current);
      sweepTimerRef.current = null;
    }
    try {
      vadRef.current?.reset();
      // Silero holds a WASM session — release it (energy VAD has no destroy).
      await (vadRef.current as { destroy?: () => Promise<void> } | null)?.destroy?.();
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
    voidedTurnsRef.current.clear();
    pendingConfirmRef.current = null;
  }, [stopSpeaking]);

  const enable = useCallback(async () => {
    if (enabledRef.current) return;
    patch({ enabled: true, error: null });
    try {
      const player = new AudioPlayer(16_000);
      await player.init();
      playerRef.current = player;

      const capture = new AudioCapture(16_000);
      const stt = new ElevenLabsSTTAdapter({ getToken: () => fetchToken("/api/voice/stt-token") });
      captureRef.current = capture;
      sttRef.current = stt;

      // VAD choice. Default: the zero-cost energy VAD — its end-of-speech
      // timing is snappy and per-chunk cost is nil. The neural Silero adapter
      // discriminates speech from noise better, but runs ONNX inference on
      // the main thread per frame and noticeably delays end-of-speech on some
      // machines — OPT-IN via NEXT_PUBLIC_VOICE_VAD=silero. The
      // confirmed-barge-in, misfire release, and stuck-gate watchdog all work
      // with either adapter.
      let vad: VADAdapter | null = null;
      if (process.env.NEXT_PUBLIC_VOICE_VAD === "silero") {
        try {
          const { SileroVADAdapter } = await import("glove-voice/silero-vad");
          const silero = new SileroVADAdapter({ redemptionMs: VAD_SILENCE_MS });
          await silero.init();
          vad = silero;
        } catch {
          vad = null; // fall through to the energy VAD
        }
      }
      if (!vad) vad = new VAD({ minSpeechMs: 250, silenceMs: VAD_SILENCE_MS });
      vadRef.current = vad;

      // Dispatch straight from the live partial — the single biggest STT-side
      // win. Scribe's committed transcript is a ~350ms server round-trip that
      // almost always returns EXACTLY the last partial (the adapter even falls
      // back to the partial when the commit comes back empty). So at endpoint
      // time we send what we already have, fire the commit only to reset
      // Scribe's utterance state, and swallow the confirm when it lands —
      // logging a mismatch metric on the rare occasions it differs.
      const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      // Scribe's rolling buffer can KEEP already-dispatched text — after we
      // send "Hey, my name is Sam." the next partial may read "Hey, my name
      // is Sam. I need some help." Re-dispatching that raw would duplicate
      // the intro. Track what was last sent and strip it as a prefix; when a
      // partial arrives that doesn't extend it, Scribe reset and we clear.
      let lastDispatched = "";
      const livePartial = (): string => {
        let p = sttRef.current?.currentPartial?.trim() ?? "";
        if (lastDispatched) {
          if (p.startsWith(lastDispatched)) {
            p = p.slice(lastDispatched.length).trim();
          } else if (lastDispatched.startsWith(p)) {
            p = ""; // stale echo of what we already sent
          } else {
            lastDispatched = ""; // buffer reset — a genuinely fresh utterance
          }
        }
        return p;
      };
      const dispatchFromPartial = (source: "endpoint" | "stable" | "hold" | "sweep"): boolean => {
        const text = livePartial();
        if (!text) return false;
        lastDispatched = sttRef.current?.currentPartial?.trim() ?? text;
        const endAt = speechEndAtRef.current;
        speechEndAtRef.current = 0;
        emitMetric("stt_dispatch_ms", endAt ? Date.now() - endAt : 0, {
          chars: text.length,
          source,
        });
        pendingConfirmRef.current = text;
        sttRef.current?.flushUtterance();
        patch({ partial: "" });
        markUtteranceSent();
        argsRef.current.onUtterance(argsRef.current.getSpeaker(), text);
        return true;
      };

      stt.on("partial", () => {
        // Freshness signal for the gate watchdog: a moving transcript means a
        // real person is talking, not just VAD-tripping noise.
        lastPartialAtRef.current = Date.now();
        const live = livePartial();
        patch({ partial: live });
        // Stable-transcript dispatch: in a noisy room the VAD can stay
        // "speaking" (a TV IS speech to a neural VAD) long after the USER
        // finished, so speech_end may fire seconds late or not at all. If the
        // partial stops changing for a second while the VAD still claims
        // speech, dispatch what we have.
        if (stableFlushRef.current) clearTimeout(stableFlushRef.current);
        if (live) {
          stableFlushRef.current = setTimeout(() => {
            stableFlushRef.current = null;
            if (!enabledRef.current || !gateOpenRef.current) return;
            if (!vadRef.current?.isSpeaking) return; // speech_end will handle it
            emitMetric("stt_stable_flush", undefined, { chars: live.length });
            dispatchFromPartial("stable");
          }, 1000);
        }
      });
      stt.on("final", (t) => {
        if (stableFlushRef.current) {
          clearTimeout(stableFlushRef.current);
          stableFlushRef.current = null;
        }
        const text = t.trim();
        // The confirm for an utterance we already dispatched from its partial:
        // swallow it (re-sending would duplicate the turn), but log when
        // Scribe's committed text materially differs from what we sent.
        const confirm = pendingConfirmRef.current;
        if (confirm !== null) {
          pendingConfirmRef.current = null;
          if (text && normalize(text) !== normalize(confirm)) {
            emitMetric("stt_final_mismatch", undefined, {
              sentChars: confirm.length,
              finalChars: text.length,
            });
          }
          return;
        }
        patch({ partial: "" });
        if (!text) return;
        // Dedupe against the last dispatched text here too — a commit of a
        // buffer that still carried already-sent words must not repeat them.
        let fresh = text;
        if (lastDispatched) {
          if (fresh.startsWith(lastDispatched)) fresh = fresh.slice(lastDispatched.length).trim();
          else if (lastDispatched.startsWith(fresh)) fresh = "";
        }
        if (!fresh) return;
        // Only measure against a FRESH speech_end. Scribe can auto-commit
        // accumulated audio long after the last VAD boundary (e.g. echo /
        // noise-floor drift keeps VAD "speaking") — measuring those against a
        // stale timestamp produced garbage like stt_final_ms=142s.
        const endAt = speechEndAtRef.current;
        speechEndAtRef.current = 0;
        if (endAt && Date.now() - endAt < 10_000) {
          emitMetric("stt_final_ms", Date.now() - endAt, { chars: fresh.length });
        }
        markUtteranceSent();
        argsRef.current.onUtterance(argsRef.current.getSpeaker(), fresh);
      });
      stt.on("error", (e) => patch({ error: e.message }));

      // Barge-in — only on CONFIRMED speech: the user talks over Nova, so
      // void current + queued speech. Estimate how much of the active turn
      // actually played BEFORE tearing it down, so the model can be told
      // where it was cut.
      const bargeIn = () => {
        if (!speakingRef.current) return;
        const active = activeRef.current;
        const playedMs = active?.firstChunkAt ? Date.now() - active.firstChunkAt : 0;
        const heard = active ? estimateHeard(active.sentText, playedMs) : "";
        const spokenMs = Date.now() - novaSpeakStartRef.current;
        const dropped = queueRef.current.length;
        // Void the server turn ids of everything being killed — their
        // remaining deltas are still streaming from the server, and without
        // this they'd re-queue as a new speech turn and Nova would "resume
        // reading" the moment the user goes quiet.
        for (const t of [activeRef.current, ...queueRef.current]) {
          if (t?.serverTurnId != null) voidedTurnsRef.current.add(t.serverTurnId);
        }
        stopSpeaking();
        speakingRef.current = false;
        gateOpenRef.current = true; // route this utterance to STT
        emitMetric("barge_in", spokenMs, { droppedQueuedTurns: dropped, heardChars: heard.length });
        argsRef.current.onInterruption?.(heard, playedMs);
        setState((s) => ({ ...s, interruptions: s.interruptions + 1, speaking: false, listening: true }));
      };

      vad.on("speech_start", () => {
        userSpeakingRef.current = true;
        // Resumed mid-thought — cancel any pending endpoint hold; this is
        // still the same utterance.
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        // The user (probably) started talking → an utterance (and likely a
        // Nova reply) is coming. Open the TTS socket now, overlapping STT +
        // model time. Cheap even on a false positive.
        prewarm();
        // Energy-VAD fallback has no confirmed-speech signal — emulate one:
        // cut Nova only if the "speech" is still going 250ms later.
        if (!vad.supportsRealStart && speakingRef.current) {
          setTimeout(() => {
            if (vadRef.current?.isSpeaking) bargeIn();
          }, 250);
        }
      });
      // Silero: fired once speech survives the minimum-duration filter — a
      // person is definitely talking, not a noise burst.
      vad.on("speech_real_start", bargeIn);
      vad.on("vad_misfire", () => {
        // Tentative speech was retracted (noise burst) — release the gate.
        userSpeakingRef.current = false;
        maybeStartNextRef.current();
      });
      vad.on("speech_end", () => {
        userSpeakingRef.current = false;
        speechEndAtRef.current = Date.now();
        if (gateOpenRef.current) {
          const partial = livePartial();
          if (!partial) {
            // Nothing NEW to send. Only fall back to the commit round-trip
            // when the buffer is truly empty (STT lagging the VAD boundary) —
            // committing a buffer of already-dispatched text would duplicate
            // it via the final handler.
            if (!(sttRef.current?.currentPartial ?? "").trim()) {
              sttRef.current?.flushUtterance();
            }
          } else {
            // Semantic endpointing: the turn detector decides how much longer
            // to wait past the VAD boundary. Resumed speech cancels the hold;
            // the utterance keeps accumulating.
            void Promise.resolve(TURN_DETECTOR.decide(partial)).then(({ holdMs, reason }) => {
              if (!enabledRef.current || !gateOpenRef.current) return;
              if (userSpeakingRef.current) return; // already resumed
              if (holdMs <= 0) {
                dispatchFromPartial("endpoint");
                return;
              }
              emitMetric("endpoint_hold", holdMs, { chars: partial.length, reason });
              if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
              holdTimerRef.current = setTimeout(() => {
                holdTimerRef.current = null;
                if (!enabledRef.current || !gateOpenRef.current) return;
                if (userSpeakingRef.current) return; // they picked the thought back up
                dispatchFromPartial("hold");
              }, holdMs);
            });
          }
        }
        // A relay held back by the user's speech can play now (§5).
        maybeStartNextRef.current();
      });

      // Idle-buffer sweeper. speech_end is the primary dispatch trigger, but
      // it can fire while the gate is CLOSED (Nova mid-audio) or a hold can
      // bail on a VAD blip — and then nothing ever re-examines the leftover
      // transcript: it just sits in the bar until Scribe eventually
      // auto-commits. Sweep: whenever we're idle (gate open, nobody speaking,
      // no hold pending) and the transcript has been still for >1.2s,
      // dispatch it.
      sweepTimerRef.current = setInterval(() => {
        if (!enabledRef.current || !gateOpenRef.current) return;
        if (userSpeakingRef.current || vadRef.current?.isSpeaking) return;
        if (speakingRef.current) return; // Nova talking — her endSpeaking reopens the path
        if (holdTimerRef.current) return; // an endpoint hold owns this buffer
        if (Date.now() - lastPartialAtRef.current < 1200) return;
        if (!livePartial()) return;
        emitMetric("stt_sweep", undefined, { chars: livePartial().length });
        dispatchFromPartial("sweep");
      }, 400);

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
  }, [cleanup, emitMetric, markUtteranceSent, patch, prewarm, stopSpeaking, writingTurn]);

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
