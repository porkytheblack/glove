// ─────────────────────────────────────────────────────────────────────────────
// The LiveKit room transport.
//
// What every LiveKit-backed voice host otherwise hand-rolls, once: join the
// room, publish the agent's voice as a paced audio track, feed every remote
// mic track back out as PCM events, and carry JSON messages on the data
// channel. Barge-in stays server-authoritative — `clear()` flushes the
// outbound AudioSource queue, so there is no client playback buffer to
// chase.
//
// The transport is deliberately agent-agnostic (PCM in, PCM out, events);
// `attachRealtime` binds it to a glove RealtimeAgent in one call, and
// `avatarWire()` hands the same room connection to a LiveKit avatar adapter
// so the face and the voice share one participant session.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { resamplePcm } from "./session";
import { RoomAvatarWire } from "./wire";

export interface LiveKitTransportConfig {
  /** wss://… server URL. */
  url: string;
  /** A pre-minted join token — see `mintParticipantToken`. */
  token: string;
  /**
   * Publish the agent's voice as a room audio track (default true). Set
   * false when a LiveKit avatar renders the voice instead — the avatar
   * worker publishes the synchronized audio+video, and publishing our own
   * copy would double it.
   */
  publishAgentAudio?: boolean;
  /** Sample rate of the published agent track. Default 24000 — what the
   *  realtime providers emit. */
  publishRate?: number;
  trackName?: string;
}

export type LiveKitTransportEvents = {
  connected: [];
  disconnected: [];
  participant_connected: [identity: string];
  participant_disconnected: [identity: string];
  /** A remote participant's audio, one AudioFrame at a time. */
  audio: [pcm: Int16Array, sampleRate: number, identity: string];
  /** A JSON message from the data channel. */
  data: [msg: unknown, identity: string | undefined];
  error: [err: Error];
};

export class LiveKitTransport extends EventEmitter<LiveKitTransportEvents> {
  readonly room = new Room();
  private source: AudioSource | null = null;
  private captureChain: Promise<void> = Promise.resolve();
  private stopReaders: Array<() => void> = [];
  private connected = false;

  constructor(private readonly cfg: LiveKitTransportConfig) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get localIdentity(): string | undefined {
    return this.room.localParticipant?.identity;
  }

  private get publishRate(): number {
    return this.cfg.publishRate ?? 24_000;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) =>
      this.emit("participant_connected", p.identity),
    );
    this.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) =>
      this.emit("participant_disconnected", p.identity),
    );

    const decoder = new TextDecoder();
    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      try {
        this.emit("data", JSON.parse(decoder.decode(payload)), participant?.identity);
      } catch {
        /* not ours */
      }
    });

    // Every remote audio track streams back out as PCM events. Avatar audio
    // is EXCLUDED — it is the agent's own voice coming back, and feeding it
    // to the S2S model would make the agent hear itself.
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      if (participant.attributes?.["lk.publish_on_behalf"]) return;
      let live = true;
      this.stopReaders.push(() => {
        live = false;
      });
      void (async () => {
        const stream = new AudioStream(track);
        for await (const frame of stream) {
          if (!live) break;
          this.emit("audio", frame.data, frame.sampleRate, participant.identity);
        }
      })().catch(() => {
        /* track ended */
      });
    });

    await this.room.connect(this.cfg.url, this.cfg.token, { autoSubscribe: true, dynacast: false });

    if (this.cfg.publishAgentAudio !== false) {
      this.source = new AudioSource(this.publishRate, 1);
      const track = LocalAudioTrack.createAudioTrack(this.cfg.trackName ?? "agent-voice", this.source);
      await this.room.localParticipant?.publishTrack(
        track,
        new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
      );
    }

    this.connected = true;
    this.emit("connected");
  }

  /** Queue agent PCM onto the published track. Paced by AudioSource —
   *  captureFrame applies backpressure so bursty provider audio plays at
   *  realtime. No-op when `publishAgentAudio` is false. */
  sendAudio(pcm: Int16Array, format: { sampleRate: number }): void {
    const source = this.source;
    if (!source) return;
    const at = resamplePcm(pcm, format.sampleRate, this.publishRate);
    const frame = new AudioFrame(at, this.publishRate, 1, at.length);
    this.captureChain = this.captureChain.then(() => source.captureFrame(frame)).catch(() => {});
  }

  /** Barge-in flush: drop every queued-but-unplayed agent sample. */
  clear(): void {
    this.source?.clearQueue();
  }

  /** Publish a JSON message to the data channel (reliable). */
  sendData(msg: unknown): void {
    void this.room.localParticipant
      ?.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true })
      .catch(() => {});
  }

  /** The avatar-datastream leg of THIS room connection, aimed at the given
   *  avatar worker identity — pass to TavusLiveKitAvatar / AnamLiveKitAvatar. */
  avatarWire(avatarIdentity: string): RoomAvatarWire {
    return new RoomAvatarWire(this.room, avatarIdentity);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    for (const stop of this.stopReaders) stop();
    this.stopReaders = [];
    await this.room.disconnect().catch(() => {});
    this.emit("disconnected");
  }
}
