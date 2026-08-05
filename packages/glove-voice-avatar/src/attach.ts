// The one-call wiring between the voice stack and the face.
//
// Everything the avatar needs already exists as events on the S2S adapter:
// `audio` is the agent's speech as PCM, `agent_speech_stopped` closes the
// utterance, and `interrupted` is the barge-in flush the voice side already
// guarantees (conformance-enforced over there). The bridge subscribes the
// three and nothing else — the mic path, tool calls, and delegation are
// none of the avatar's business.

import type { RealtimeAgent } from "glove-voice-s2s";
import type { AvatarAdapter } from "./types";

export interface AttachAvatarOptions {
  /** Also start the avatar session (connect) if it isn't connected yet. */
  connect?: boolean;
}

/**
 * Subscribe an avatar to a RealtimeAgent's speech. Returns a detach function
 * that removes exactly the listeners it added — the host's own listeners on
 * either side survive.
 */
export async function attachAvatar(
  rt: RealtimeAgent,
  avatar: AvatarAdapter,
  opts?: AttachAvatarOptions,
): Promise<() => void> {
  if (opts?.connect !== false && !avatar.isConnected) {
    await avatar.connect();
  }

  const onAudio = (pcm: Int16Array, format: Parameters<AvatarAdapter["sendAudio"]>[1]) =>
    avatar.sendAudio(pcm, format);
  const onStopped = () => avatar.endUtterance();
  const onInterrupted = () => avatar.interrupt();

  rt.adapter.on("audio", onAudio);
  rt.adapter.on("agent_speech_stopped", onStopped);
  rt.adapter.on("interrupted", onInterrupted);

  return () => {
    rt.adapter.off("audio", onAudio);
    rt.adapter.off("agent_speech_stopped", onStopped);
    rt.adapter.off("interrupted", onInterrupted);
  };
}
