"use client";

// The entire client-side voice implementation.
//
// Count what is NOT here: no API keys, no token fetches, no silence timers, no
// endpointing heuristics, no turn detection, no transcript dedupe, no agent or
// model code. All of it runs in the room. What remains is a duct — microphone
// up, speakers down — plus whatever state the room tells us to render.
//
// The one exception is a VAD, and it earns its place as a REFLEX, not a
// decision: it only stops playback the instant it hears a person, because a
// server round trip is the difference between the agent cutting off and the
// agent talking over you. Whether that person actually interrupted, what they
// said, and when their turn ended all remain the room's calls.
//
// The equivalent logic in `examples/layered-voice` is a ~1100-line commitment
// engine inside a React hook. This is the same product with the decisions moved
// to where they can see everything and be tuned without shipping a client.

import { useCallback, useEffect, useRef, useState } from "react";

export interface LogLine {
  id: number;
  who: string;
  text: string;
  kind: "user" | "nova" | "system" | "error";
}

export type SpeakerRole = "operator" | "customer" | "bystander";

export interface RoomState {
  status: string;
  connected: boolean;
  partial: string;
  log: LogLine[];
  ttft: number | null;
  ttftAvg: number | null;
  workerBusy: boolean;
  config: Record<string, unknown> | null;
  error: string | null;
}

/** A local pause the room never resolved is lifted after this long. Longer
 *  than any confirm/retract round trip, short enough not to be a dropout. */
const LOCAL_PAUSE_MAX_MS = 1500;

const INITIAL: RoomState = {
  status: "idle",
  connected: false,
  partial: "",
  log: [],
  ttft: null,
  ttftAvg: null,
  workerBusy: false,
  config: null,
  error: null,
};

export function useRoom() {
  const [state, setState] = useState<RoomState>(INITIAL);
  const patch = useCallback(
    (p: Partial<RoomState>) => setState((s) => ({ ...s, ...p })),
    [],
  );

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef<string | null>(null);
  const seq = useRef(0);
  const ttfts = useRef<number[]>([]);
  const turnRef = useRef(0);
  const endedTurns = useRef<Set<number>>(new Set());
  const novaTurn = useRef<number | null>(null);
  const localVadRef = useRef<import("glove-voice").VADAdapter | null>(null);
  /** Is there audio in the playback buffer right now? Gates the local reflex
   *  so a stray "pause" cannot arrive while nothing is playing. */
  const playbackActiveRef = useRef(false);
  const localVadFailures = useRef(0);
  /** We paused playback ourselves and are waiting to hear back from the room. */
  const pausedLocallyRef = useRef(false);
  const localPauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Undo a local pause the room never resolved. A no-op once the room has
   *  spoken — `clear` and `resume` both clear the flag. */
  const liftLocalPause = useCallback(() => {
    if (localPauseTimer.current) {
      clearTimeout(localPauseTimer.current);
      localPauseTimer.current = null;
    }
    if (!pausedLocallyRef.current) return;
    pausedLocallyRef.current = false;
    playbackRef.current?.port.postMessage("resume");
  }, []);

  const line = useCallback((who: string, text: string, kind: LogLine["kind"]) => {
    setState((s) => ({
      ...s,
      log: [...s.log.slice(-200), { id: ++seq.current, who, text, kind }],
    }));
  }, []);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // ── audio ──────────────────────────────────────────────────────────────────

  const startAudio = useCallback(async () => {
    // 16 kHz end to end — the rate the room, Scribe and ElevenLabs all use, so
    // nothing resamples anywhere along the path.
    const ctx = new AudioContext({ sampleRate: 16_000 });
    ctxRef.current = ctx;
    await ctx.audioWorklet.addModule("/capture-worklet.js");
    await ctx.audioWorklet.addModule("/playback-worklet.js");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Browser-side echo cancellation still earns its keep: it keeps Nova's
        // own voice out of the microphone. Every other decision is the room's.
        echoCancellation: true,
        noiseSuppression: true,
        // AGC OFF, deliberately.
        //
        // It exists to make every voice arrive at the same level, which is
        // exactly the information the room needs to keep: how loud the caller
        // is relative to everyone else near them is the only cue that tells
        // their voice apart from the next table's. Automatic gain erases that
        // difference by design — it rides the quiet neighbour up during the
        // caller's pauses until the two are indistinguishable.
        //
        // It also actively hurt the phantom gate earlier, lifting room tone
        // above any energy floor low enough to hear a real interruption.
        autoGainControl: process.env.NEXT_PUBLIC_MIC_AGC === "1",
      },
    });
    streamRef.current = stream;

    // A LOCAL VAD, purely as a reflex.
    //
    // Every decision that matters — endpointing, transcription, what the
    // interruption meant — still belongs to the room. But `examples/
    // layered-voice`, where barge-in has always felt right, detects speech in
    // the same process that plays the audio: mic → VAD → stop, synchronously,
    // no network in the loop. Moving the VAD server-side put a round trip
    // between the caller opening their mouth and the agent going quiet, and
    // that gap is the whole difference between "it cuts off" and "it talks
    // over me". So the browser keeps a copy of the reflex: stop playback the
    // instant it hears a person, and let the room confirm or retract as it
    // always has. Wrong-either-way is free — a misfire resumes mid-word.
    //
    // NOT AWAITED, deliberately. `connect()` only opens the WebSocket once
    // `startAudio()` resolves, so awaiting the VAD's construction here put a
    // model download in front of the socket: when it was slow or blocked, the
    // room never got a connection and the call was silent end to end. The
    // reflex attaches whenever it is ready; the call never waits for it.
    localVadFailures.current = 0;
    localVadRef.current = null;
    void (async () => {
      let vad: import("glove-voice").VADAdapter | null = null;
      // Try the neural VAD twice before settling for the energy one, because
      // the difference is not cosmetic: only Silero reports `speech_real_start`,
      // and that event is what sends `barge_in` to the room. An energy VAD
      // silently costs you client-side interruption entirely.
      //
      // Self-hosted assets first (see scripts/vendor-vad.mjs) so a locked-down
      // network still gets the model — but those files are GENERATED and
      // gitignored, so any run that skipped the prebuild step has no /vad/ to
      // serve. Falling back to the adapter's own CDN default costs nothing and
      // turns a hard failure into a slower start.
      const { SileroVADAdapter } = await import("glove-voice/silero-vad").catch(() => ({
        SileroVADAdapter: null as unknown as never,
      }));
      // Same sensitivity as the room. Silero's recommended 0.5 assumes a quiet
      // room and a close mic; outdoors or over background noise, ordinary
      // speech scores under it and the caller has to raise their voice just to
      // be heard. Here a false positive only pauses playback and resumes, so
      // the bar belongs low.
      const sensitivity = {
        redemptionMs: 450,
        positiveSpeechThreshold: Number(process.env.NEXT_PUBLIC_VAD_POSITIVE ?? 0.35),
        negativeSpeechThreshold: Number(process.env.NEXT_PUBLIC_VAD_NEGATIVE ?? 0.25),
      };
      for (const opts of [
        { ...sensitivity, modelURL: "/vad/silero_vad_v5.onnx", wasm: { type: "local" as const, path: "/vad/" } },
        sensitivity,
      ]) {
        if (!SileroVADAdapter) break;
        try {
          const silero = new SileroVADAdapter(opts);
          await silero.init();
          vad = silero;
          break;
        } catch {
          /* try the next source */
        }
      }
      if (!vad) {
        try {
          const { VAD } = await import("glove-voice");
          vad = new VAD({ minSpeechMs: 250, silenceMs: 450 });
          console.warn(
            "[room] neural VAD unavailable from BOTH /vad/ and the CDN — falling back to the energy VAD, " +
              "which cannot confirm speech, so client-side barge-in is OFF. Run `pnpm vendor:vad` in examples/server-voice/web.",
          );
        } catch {
          console.warn("[room] no local VAD — barge-in handled entirely by the room");
          return;
        }
      }
      // The call may already be over by the time this resolves.
      if (!ctxRef.current) return;
      // Pause on the FIRST hint of a voice, not on confirmation. If you say
      // "ok" or "yeah" over her, that is an interruption and she should stop —
      // the agent has no business judging whether what you said was important
      // enough to warrant the floor. Confirmation only decides what happens
      // NEXT: a real utterance escalates to a full barge-in, a noise burst
      // resumes mid-word. Stopping is free; talking over you is not.
      // The client OWNS un-pausing its own pause.
      //
      // The worklet holds `paused` until something tells it otherwise, and the
      // room is not guaranteed to say anything: if her audio finished between
      // our pause and the room reading the barge-in, the room declines it and
      // sends neither `clear` nor `resume`. The pause then never lifts, every
      // later turn's audio piles into a buffer nobody drains, and the call is
      // dead until it is redialled — reported as "after the first interruption
      // she stops responding at all". So whatever we pause, we un-pause, and
      // the room's `clear` merely supersedes us.
      vad.on("speech_start", () => {
        if (!playbackActiveRef.current) return;
        playbackRef.current?.port.postMessage("pause");
        pausedLocallyRef.current = true;
        if (localPauseTimer.current) clearTimeout(localPauseTimer.current);
        localPauseTimer.current = setTimeout(liftLocalPause, LOCAL_PAUSE_MAX_MS);
      });
      vad.on("speech_end", liftLocalPause);
      vad.on("speech_real_start", () => {
        if (!playbackActiveRef.current) return;
        playbackRef.current?.port.postMessage("pause");
        send({ t: "barge_in" }); // the room decides what to do about it
      });
      vad.on?.("vad_misfire", liftLocalPause);
      localVadRef.current = vad;
    })();

    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, "capture");
    capture.port.onmessage = (e: MessageEvent) => {
      // SEND FIRST. The microphone reaching the room is the one thing on this
      // path that cannot be allowed to fail, and the local VAD is an optional
      // luxury sitting right next to it: it loads a model and a WASM runtime
      // from a CDN, so it can fail in ways nothing here controls. Feeding it
      // before the send meant one throw per frame silently cut the audio off
      // at the source — the room stayed connected and heard nothing at all.
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer);

      const vad = localVadRef.current;
      if (!vad) return;
      try {
        vad.process(e.data as Int16Array);
      } catch {
        // One bad frame is noise; a broken VAD is permanent. Drop the reflex
        // rather than throw on every 20ms chunk for the rest of the call —
        // the room's own VAD still detects barge-in, just a beat later.
        if (++localVadFailures.current >= 5) {
          localVadRef.current = null;
          console.info("[room] local VAD disabled after repeated failures — barge-in falls back to the room");
        }
      }
    };
    source.connect(capture);
    // Keep the node in the graph without routing the mic to the speakers.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    capture.connect(mute).connect(ctx.destination);

    const playback = new AudioWorkletNode(ctx, "playback", { outputChannelCount: [1] });
    playback.port.onmessage = (e: MessageEvent) => {
      if (e.data !== "drained") return;
      // Only report a turn drained once the room said it finished generating —
      // a mid-turn network underrun must not reopen the microphone early.
      if (endedTurns.current.has(turnRef.current)) {
        endedTurns.current.delete(turnRef.current);
        playbackActiveRef.current = false;
        send({ t: "playback_done", turnId: turnRef.current });
      }
    };
    playback.connect(ctx.destination);
    playbackRef.current = playback;
  }, [send]);

  const stopAudio = useCallback(() => {
    if (localPauseTimer.current) {
      clearTimeout(localPauseTimer.current);
      localPauseTimer.current = null;
    }
    pausedLocallyRef.current = false;
    localVadRef.current?.removeAllListeners?.();
    localVadRef.current = null;
    playbackActiveRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close();
    ctxRef.current = null;
    playbackRef.current = null;
    streamRef.current = null;
  }, []);

  // ── connect / hang up ──────────────────────────────────────────────────────

  const hangUp = useCallback(async () => {
    wsRef.current?.close();
    wsRef.current = null;
    stopAudio();
    const runId = runRef.current;
    runRef.current = null;
    if (runId) {
      // Cancelling the run SIGTERMs the room, which closes it gracefully and
      // frees the port for the next caller.
      await fetch(`/api/rooms?runId=${runId}`, { method: "DELETE" }).catch(() => {});
    }
    setState((s) => ({ ...INITIAL, log: s.log }));
  }, [stopAudio]);

  const connect = useCallback(async () => {
    patch({ status: "claiming a room…", error: null });
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = (await res.json()) as {
        runId?: string;
        port?: number;
        wsUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.wsUrl) throw new Error(data.error ?? "could not allocate a room");
      runRef.current = data.runId ?? null;

      // The room has to be picked up by the runner, spawn, load the endpointing
      // model and bind its port. The very FIRST room also downloads the model
      // (~150MB), so allow minutes — but ask our own server rather than the
      // room, so a run that died is reported straight away instead of us
      // waiting out the whole window for a room that no longer exists.
      const started = Date.now();
      const deadline = started + 240_000;
      for (;;) {
        const waited = Math.round((Date.now() - started) / 1000);
        patch({
          status:
            waited < 8
              ? "starting the room…"
              : `starting the room… ${waited}s (first run downloads the endpointing model)`,
        });
        if (Date.now() > deadline) throw new Error("the room never came up");
        const s = await fetch(
          `/api/rooms?runId=${data.runId}&port=${data.port}`,
          { cache: "no-store" },
        )
          .then((r) => r.json())
          .catch(() => ({ ready: false, dead: false }));
        if (s.dead) throw new Error(s.error ?? "the room stopped before it was ready");
        if (s.ready) break;
        await new Promise((r) => setTimeout(r, 700));
      }

      await startAudio();

      patch({ status: "connecting…" });
      const ws = new WebSocket(data.wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
          playbackActiveRef.current = true;
          playbackRef.current?.port.postMessage(e.data, [e.data]);
          return;
        }
        const msg = JSON.parse(e.data as string);
        switch (msg.t) {
          case "ready":
            patch({ connected: true, status: "listening", config: msg.config });
            line("system", `${msg.sessionId} — just talk`, "system");
            break;
          case "partial":
            patch({ partial: msg.text });
            break;
          case "utterance":
            patch({ partial: "" });
            line(msg.speaker, msg.text, "user");
            break;
          case "speech":
            if (novaTurn.current !== msg.turnId) {
              novaTurn.current = msg.turnId;
              turnRef.current = msg.turnId;
              line("Nova", msg.text, "nova");
            } else {
              setState((s) => {
                const log = [...s.log];
                const last = log[log.length - 1];
                if (last?.kind === "nova") log[log.length - 1] = { ...last, text: last.text + msg.text };
                return { ...s, log };
              });
            }
            break;
          case "speech_end":
            endedTurns.current.add(msg.turnId);
            novaTurn.current = null;
            break;
          case "pause":
            // Possible interruption: go silent NOW, keep the buffer.
            playbackRef.current?.port.postMessage("pause");
            break;
          case "resume":
            // False alarm — carry on mid-word. The room has spoken, so our own
            // pause is resolved and its timer must not fire later.
            pausedLocallyRef.current = false;
            if (localPauseTimer.current) {
              clearTimeout(localPauseTimer.current);
              localPauseTimer.current = null;
            }
            playbackRef.current?.port.postMessage("resume");
            break;
          case "clear":
            // Barge-in: drop every buffered sample immediately. `clear` also
            // unpauses the worklet, so our local pause is resolved.
            pausedLocallyRef.current = false;
            if (localPauseTimer.current) {
              clearTimeout(localPauseTimer.current);
              localPauseTimer.current = null;
            }
            playbackActiveRef.current = false;
            playbackRef.current?.port.postMessage("clear");
            endedTurns.current.clear();
            novaTurn.current = null;
            line("system", "interrupted", "system");
            break;
          case "state":
            patch({
              status: msg.speaking ? "Nova speaking" : msg.thinking ? "thinking" : "listening",
            });
            break;
          case "delegation":
            patch({ workerBusy: msg.phase === "queued" });
            line(
              "worker",
              msg.phase === "queued"
                ? `researching: ${msg.detail ?? ""}`
                : msg.phase === "failed"
                  ? `failed: ${msg.detail ?? ""}`
                  : "worker replied",
              "system",
            );
            break;
          case "metric":
            if (msg.name === "front_ttft_ms" && typeof msg.ms === "number") {
              ttfts.current.push(msg.ms);
              const avg = Math.round(
                ttfts.current.reduce((a, b) => a + b, 0) / ttfts.current.length,
              );
              patch({ ttft: msg.ms, ttftAvg: avg });
            }
            break;
          case "error":
            line("error", msg.message, "error");
            break;
        }
      };

      ws.onclose = () => {
        patch({ connected: false, status: "idle" });
        stopAudio();
      };
      ws.onerror = () => patch({ error: "connection to the room failed" });
    } catch (err) {
      patch({ status: "idle", error: (err as Error).message });
      stopAudio();
    }
  }, [line, patch, startAudio, stopAudio]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopAudio();
    };
  }, [stopAudio]);

  const setSpeaker = useCallback((speaker: SpeakerRole) => send({ t: "speaker", speaker }), [send]);
  const say = useCallback(
    (speaker: SpeakerRole, text: string) => send({ t: "say", speaker, text }),
    [send],
  );

  return { state, connect, hangUp, setSpeaker, say };
}
