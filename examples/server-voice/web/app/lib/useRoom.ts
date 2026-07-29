"use client";

// The entire client-side voice implementation.
//
// Count what is NOT here: no API keys, no token fetches, no VAD, no silence
// timers, no endpointing heuristics, no turn detection, no transcript dedupe,
// no barge-in logic, no agent or model code. All of it runs in the room beacon.
// What remains is a duct — microphone up, speakers down — plus whatever state
// the room tells us to render.
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
  const roomRef = useRef<string | null>(null);
  const seq = useRef(0);
  const ttfts = useRef<number[]>([]);
  const turnRef = useRef(0);
  const endedTurns = useRef<Set<number>>(new Set());
  const novaTurn = useRef<number | null>(null);

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
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, "capture");
    capture.port.onmessage = (e: MessageEvent) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer);
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
        send({ t: "playback_done", turnId: turnRef.current });
      }
    };
    playback.connect(ctx.destination);
    playbackRef.current = playback;
  }, [send]);

  const stopAudio = useCallback(() => {
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
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      // Release the beacon slot for the next caller.
      await fetch(`/api/rooms?room=${room}`, { method: "DELETE" }).catch(() => {});
    }
    setState((s) => ({ ...INITIAL, log: s.log }));
  }, [stopAudio]);

  const connect = useCallback(async () => {
    patch({ status: "claiming a room…", error: null });
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = (await res.json()) as {
        room?: string;
        wsUrl?: string;
        healthUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.wsUrl) throw new Error(data.error ?? "could not allocate a room");
      roomRef.current = data.room ?? null;

      // The room binds its port and loads the endpointing model before it is
      // ready. The very first room start also downloads the model, so wait
      // generously rather than failing the connect.
      patch({ status: "starting the room…" });
      const deadline = Date.now() + 180_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("the room never came up");
        try {
          const h = await fetch(data.healthUrl!, { cache: "no-store" });
          if (h.ok) break;
        } catch {
          /* not listening yet */
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      await startAudio();

      patch({ status: "connecting…" });
      const ws = new WebSocket(data.wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
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
          case "clear":
            // Barge-in: drop every buffered sample immediately.
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
