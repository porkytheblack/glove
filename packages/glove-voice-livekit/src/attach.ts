// The one-call bridge between a glove RealtimeAgent and a LiveKit room —
// the LiveKit sibling of glove-voice-avatar's `attachAvatar`.

import type { RealtimeAgent } from "glove-voice-s2s";
import { resamplePcm } from "./session";
import type { LiveKitTransport } from "./transport";

export interface AttachRealtimeOptions {
  /**
   * Forward the agent's voice to the transport's published track (default
   * true). Set false when `attachAvatar` carries the voice to a LiveKit
   * avatar instead — the interrupt flush stays wired either way.
   */
  agentAudio?: boolean;
}

/**
 * Wire the pipes: remote mics → the S2S model, agent speech → the room
 * track, provider `interrupted` → the outbound flush. Returns a detach
 * function. Transcripts, state and app messages stay the host's business —
 * the data channel is right there on the transport.
 */
export function attachRealtime(
  rt: RealtimeAgent,
  transport: LiveKitTransport,
  opts: AttachRealtimeOptions = {},
): () => void {
  const inputRate = rt.adapter.inputFormat.sampleRate;
  const onMic = (pcm: Int16Array, sampleRate: number) => {
    rt.sendAudio(resamplePcm(pcm, sampleRate, inputRate));
  };
  transport.on("audio", onMic);

  const onAgentAudio =
    opts.agentAudio !== false
      ? (pcm: Int16Array, format: { sampleRate: number }) => transport.sendAudio(pcm, format)
      : null;
  if (onAgentAudio) rt.adapter.on("audio", onAgentAudio);

  const onInterrupted = () => transport.clear();
  rt.adapter.on("interrupted", onInterrupted);

  return () => {
    transport.off("audio", onMic);
    if (onAgentAudio) rt.adapter.off("audio", onAgentAudio);
    rt.adapter.off("interrupted", onInterrupted);
  };
}
