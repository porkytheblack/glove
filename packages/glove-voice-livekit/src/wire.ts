// ─────────────────────────────────────────────────────────────────────────────
// The avatar datastream wire.
//
// LiveKit's avatar ecosystem has a published shape: the avatar provider joins
// the SAME LiveKit room as a second participant and publishes synchronized
// audio + video itself; the agent, instead of publishing its voice to the
// room, ships PCM to the avatar participant over a byte stream and
// coordinates over RPC. The constants below are that protocol — the same
// ones LiveKit Agents' `DataStreamAudioOutput` uses, so a glove agent is
// indistinguishable from a LiveKit agent as far as the avatar worker can
// tell.
//
// The wire is an interface rather than a Room so the avatar adapters can run
// their conformance suites against a fake — the same seam the Tavus echo
// adapter's `sendInteraction` provides.
// ─────────────────────────────────────────────────────────────────────────────

import type { Room } from "@livekit/rtc-node";

/** Byte-stream topic the avatar worker reads agent PCM from. */
export const AUDIO_STREAM_TOPIC = "lk.audio_stream";
/** RPC the agent calls ON the avatar to drop buffered audio (barge-in). */
export const RPC_CLEAR_BUFFER = "lk.clear_buffer";
/** RPCs the avatar calls ON the agent as playback progresses. */
export const RPC_PLAYBACK_STARTED = "lk.playback_started";
export const RPC_PLAYBACK_FINISHED = "lk.playback_finished";
/** Token attribute marking whose tracks the avatar publishes on behalf of. */
export const ATTRIBUTE_PUBLISH_ON_BEHALF = "lk.publish_on_behalf";

/** One utterance's outbound audio: raw PCM s16le bytes, closed to flush. */
export interface AvatarWireWriter {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * The room leg an avatar adapter talks through: byte streams toward the
 * avatar participant, RPC in both directions. Production uses
 * `RoomAvatarWire` over a connected `@livekit/rtc-node` Room; tests inject a
 * fake and assert on the frames.
 */
export interface AvatarWire {
  openAudioStream(attrs: { sampleRate: number; channels: number }): Promise<AvatarWireWriter>;
  /** Call an RPC method ON the avatar participant. */
  performRpc(method: string, payload?: string): Promise<string>;
  /** Handle an RPC method the avatar calls on US (playback_started/finished). */
  onRpc(method: string, handler: (payload: string) => Promise<string> | string): void;
}

/** The real wire: a connected rtc-node Room + the avatar's identity. */
export class RoomAvatarWire implements AvatarWire {
  constructor(
    private readonly room: Room,
    private readonly avatarIdentity: string,
  ) {}

  async openAudioStream(attrs: { sampleRate: number; channels: number }): Promise<AvatarWireWriter> {
    const local = this.room.localParticipant;
    if (!local) throw new Error("room has no local participant — not connected?");
    const writer = await local.streamBytes({
      topic: AUDIO_STREAM_TOPIC,
      destinationIdentities: [this.avatarIdentity],
      // Stringly-typed by protocol: the receiver parses these to frame the
      // raw PCM back into AudioFrames.
      attributes: {
        sample_rate: String(attrs.sampleRate),
        num_channels: String(attrs.channels),
      },
    });
    return {
      write: (bytes) => writer.write(bytes),
      close: () => writer.close(),
    };
  }

  performRpc(method: string, payload = ""): Promise<string> {
    const local = this.room.localParticipant;
    if (!local) return Promise.reject(new Error("room has no local participant"));
    return local.performRpc({
      destinationIdentity: this.avatarIdentity,
      method,
      payload,
    });
  }

  onRpc(method: string, handler: (payload: string) => Promise<string> | string): void {
    this.room.localParticipant?.registerRpcMethod(method, async (data) =>
      handler(data.payload),
    );
  }
}
