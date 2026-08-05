"use client";

// The browser's leg of the ANAM avatar — the sdk-session sibling of
// useAvatarCall's Daily leg. Two jobs, same shape:
//   1. Render the face: boot the Anam SDK from the session token the room
//      minted (passthrough baked in) and stream it into the <video>.
//   2. COURIER the room's commands. Anam's passthrough audio input lives on
//      the client SDK — sendAudioChunk / endSequence / interruptPersona are
//      browser-side calls — so the room sends commands down the WS duct and
//      this hook applies them.
//
// The SDK's own mic capture stays OFF (disableInputAudio): the caller's mic
// flows through the WS duct to the S2S model — the avatar must not hear.

import { useCallback, useEffect, useRef, useState } from "react";

/** The <video> element id the SDK streams into (it attaches by id). */
export const ANAM_VIDEO_ID = "anam-avatar-video";

interface AnamAudioStream {
  sendAudioChunk(base64: string): void;
  endSequence(): void;
}

interface AnamClient {
  streamToVideoElement(videoElementId: string): Promise<void>;
  createAgentAudioInputStream(config: {
    encoding: string;
    sampleRate: number;
    channels: number;
  }): AnamAudioStream;
  interruptPersona(): void;
  stopStreaming(): Promise<void>;
  addListener(event: string, callback: (...args: unknown[]) => void): void;
}

export function useAnamSession() {
  const clientRef = useRef<AnamClient | null>(null);
  const streamRef = useRef<AnamAudioStream | null>(null);
  const [joined, setJoined] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);

  const boot = useCallback(async (sessionToken: string) => {
    if (clientRef.current) return;
    const mod = (await import("@anam-ai/js-sdk")) as unknown as {
      createClient: (token: string, opts?: Record<string, unknown>) => AnamClient;
      AnamEvent?: { CONNECTION_CLOSED?: string };
    };
    const client = mod.createClient(sessionToken, { disableInputAudio: true });
    clientRef.current = client;
    setClosedReason(null);
    // A dead session must not keep wearing a live face: without this, an
    // Anam-side end (timeout, error) leaves a black rectangle and every
    // later command lands on a closed session with no sign of why.
    client.addListener(
      mod.AnamEvent?.CONNECTION_CLOSED ?? "CONNECTION_CLOSED",
      (reason?: unknown) => {
        if (clientRef.current !== client) return;
        clientRef.current = null;
        streamRef.current = null;
        setJoined(false);
        setClosedReason(typeof reason === "string" ? reason : "connection closed");
        console.warn("[anam] session closed:", reason);
      },
    );
    await client.streamToVideoElement(ANAM_VIDEO_ID);
    // One input stream for the whole call; sequences within it are delimited
    // by endSequence — the same lifecycle the passthrough docs use.
    streamRef.current = client.createAgentAudioInputStream({
      encoding: "pcm_s16le",
      sampleRate: 16_000,
      channels: 1,
    });
    setJoined(true);
  }, []);

  const leave = useCallback(async () => {
    const client = clientRef.current;
    clientRef.current = null;
    streamRef.current = null;
    setJoined(false);
    if (client) await client.stopStreaming().catch(() => {});
  }, []);

  /** Apply a room command to the SDK session. */
  const apply = useCallback((command: Record<string, unknown>) => {
    const client = clientRef.current;
    const stream = streamRef.current;
    if (!client || !stream) return;
    switch (command.type) {
      case "audio_chunk":
        if (typeof command.audio === "string") stream.sendAudioChunk(command.audio);
        break;
      case "end_sequence":
        stream.endSequence();
        break;
      case "interrupt":
        // Both calls, per the passthrough docs: interruptPersona stops the
        // lip-sync immediately, endSequence drops the buffered tail.
        client.interruptPersona();
        stream.endSequence();
        break;
    }
  }, []);

  useEffect(() => {
    return () => {
      void leave();
    };
  }, [leave]);

  return { boot, leave, apply, joined, closedReason };
}
