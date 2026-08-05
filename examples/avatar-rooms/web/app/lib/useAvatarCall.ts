"use client";

// The browser's leg of the avatar: a Daily CALL OBJECT (not the prebuilt
// iframe), because this participant has two jobs the iframe can't do:
//   1. Render the avatar's video + audio tracks — the face AND the voice
//      both arrive through the Daily room.
//   2. COURIER Tavus interaction events. Interactions travel only over the
//      Daily data channel, and the server never joins the call — so the room
//      sends events down the WS duct and this hook relays them via
//      sendAppMessage.
//
// The local mic and camera stay OFF: the caller's mic flows through the WS
// duct to the S2S model (echo mode has no perception — nothing in this room
// listens), and joining muted also keeps the room's audio path one-way.

import { useCallback, useEffect, useRef, useState } from "react";
import Daily, { type DailyCall } from "@daily-co/daily-js";

export function useAvatarCall() {
  const callRef = useRef<DailyCall | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [joined, setJoined] = useState(false);

  const attachTracks = useCallback((call: DailyCall) => {
    for (const p of Object.values(call.participants())) {
      if (p.local) continue;
      const video = p.tracks.video?.persistentTrack;
      const audio = p.tracks.audio?.persistentTrack;
      if (video && videoRef.current) {
        videoRef.current.srcObject = new MediaStream([video]);
        void videoRef.current.play().catch(() => {});
      }
      if (audio && audioRef.current) {
        audioRef.current.srcObject = new MediaStream([audio]);
        void audioRef.current.play().catch(() => {});
      }
    }
  }, []);

  const join = useCallback(
    async (url: string) => {
      if (callRef.current) return;
      const call = Daily.createCallObject({
        url,
        audioSource: false,
        videoSource: false,
      });
      callRef.current = call;
      const refresh = () => attachTracks(call);
      call.on("track-started", refresh);
      call.on("participant-updated", refresh);
      call.on("participant-joined", refresh);
      await call.join();
      setJoined(true);
      refresh();
    },
    [attachTracks],
  );

  const leave = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    setJoined(false);
    if (call) {
      await call.leave().catch(() => {});
      call.destroy();
    }
  }, []);

  /** Relay a Tavus interaction event into the call's data channel. */
  const relay = useCallback((event: Record<string, unknown>) => {
    callRef.current?.sendAppMessage(event, "*");
  }, []);

  useEffect(() => {
    return () => {
      void leave();
    };
  }, [leave]);

  return { join, leave, relay, joined, videoRef, audioRef };
}
