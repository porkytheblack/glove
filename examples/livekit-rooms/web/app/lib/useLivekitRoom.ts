"use client";

// The entire client-side voice implementation, LiveKit edition.
//
// Compare this file with `examples/s2s-rooms/web/app/lib/useRoom.ts` (~500
// lines): the audio worklets, the playback buffer, the local VAD reflex, the
// pause/resume/clear dance and the drain accounting are all gone, because the
// transport now does that job. LiveKit carries the caller's microphone up and
// the agent's voice down as WebRTC tracks — echo-cancelled, jitter-buffered,
// codec-negotiated — and barge-in is server-authoritative: the room flushes
// its own outbound queue (`AudioSource.clearQueue()`), so there is no client
// buffer to chase. What remains here is a join, an <audio> element, and a
// JSON data channel for transcripts and typed lines.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from "livekit-client";

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
  workerBusy: boolean;
  config: Record<string, unknown> | null;
  error: string | null;
}

const INITIAL: RoomState = {
  status: "idle",
  connected: false,
  partial: "",
  log: [],
  workerBusy: false,
  config: null,
  error: null,
};

export function useLivekitRoom() {
  const [state, setState] = useState<RoomState>(INITIAL);
  const patch = useCallback(
    (p: Partial<RoomState>) => setState((s) => ({ ...s, ...p })),
    [],
  );

  const roomRef = useRef<Room | null>(null);
  const runRef = useRef<string | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const seq = useRef(0);
  const novaTurn = useRef<number | null>(null);

  const line = useCallback((who: string, text: string, kind: LogLine["kind"]) => {
    setState((s) => ({
      ...s,
      log: [...s.log.slice(-200), { id: ++seq.current, who, text, kind }],
    }));
  }, []);

  const send = useCallback((msg: unknown) => {
    const room = roomRef.current;
    if (!room) return;
    void room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true })
      .catch(() => {});
  }, []);

  // ── hang up ────────────────────────────────────────────────────────────────

  const hangUp = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    await room?.disconnect().catch(() => {});
    for (const el of audioElsRef.current) el.remove();
    audioElsRef.current = [];
    const runId = runRef.current;
    runRef.current = null;
    if (runId) {
      // Cancelling the run SIGTERMs the room signal, which disconnects the
      // agent, ends the LiveKit session and frees the port for the next caller.
      await fetch(`/api/rooms?runId=${runId}`, { method: "DELETE" }).catch(() => {});
    }
    setState((s) => ({ ...INITIAL, log: s.log }));
  }, []);

  // ── connect ────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    patch({ status: "claiming a room…", error: null });
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      const data = (await res.json()) as {
        runId?: string;
        port?: number;
        livekitUrl?: string;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.livekitUrl || !data.token)
        throw new Error(data.error ?? "could not allocate a room");
      runRef.current = data.runId ?? null;

      // Wait for the signal run to be picked up, spawn and report healthy —
      // ask our own server rather than the room, so a run that died is
      // reported straight away instead of us waiting out the whole window.
      const started = Date.now();
      const deadline = started + 240_000;
      for (;;) {
        const waited = Math.round((Date.now() - started) / 1000);
        patch({ status: waited < 8 ? "starting the room…" : `starting the room… ${waited}s` });
        if (Date.now() > deadline) throw new Error("the room never came up");
        const s = await fetch(`/api/rooms?runId=${data.runId}&port=${data.port}`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .catch(() => ({ ready: false, dead: false }));
        if (s.dead) throw new Error(s.error ?? "the room stopped before it was ready");
        if (s.ready) break;
        await new Promise((r) => setTimeout(r, 700));
      }

      patch({ status: "joining the call…" });
      const room = new Room();
      roomRef.current = room;

      // The agent's voice arrives as an ordinary WebRTC audio track. Attach it
      // to an element and the browser handles playback, jitter and clock drift.
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        audioElsRef.current.push(el);
        document.body.appendChild(el);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) {
          audioElsRef.current = audioElsRef.current.filter((a) => a !== el);
          el.remove();
        }
      });

      // Transcripts, state and delegations mirror in over the data channel.
      const decoder = new TextDecoder();
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        let msg: any;
        try {
          msg = JSON.parse(decoder.decode(payload));
        } catch {
          return;
        }
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
            novaTurn.current = null;
            break;
          case "clear":
            // Server-side barge-in already flushed the outbound audio queue in
            // the room — nothing to do to the live track. Just note it.
            line("system", "interrupted", "system");
            novaTurn.current = null;
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
          case "error":
            line("error", msg.message, "error");
            break;
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        patch({ connected: false, status: "idle" });
      });

      await room.connect(data.livekitUrl, data.token);
      // The caller's microphone: one call, and LiveKit owns capture, echo
      // cancellation, encoding and shipping from here on.
      await room.localParticipant.setMicrophoneEnabled(true);
      patch({ status: "waiting for the agent…" });
    } catch (err) {
      patch({ status: "idle", error: (err as Error).message });
      await roomRef.current?.disconnect().catch(() => {});
      roomRef.current = null;
    }
  }, [line, patch]);

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect().catch(() => {});
      for (const el of audioElsRef.current) el.remove();
      audioElsRef.current = [];
    };
  }, []);

  const setSpeaker = useCallback((speaker: SpeakerRole) => send({ t: "speaker", speaker }), [send]);
  const say = useCallback(
    (speaker: SpeakerRole, text: string) => send({ t: "say", speaker, text }),
    [send],
  );

  return { state, connect, hangUp, setSpeaker, say };
}
