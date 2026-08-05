// ─────────────────────────────────────────────────────────────────────────────
// The shared half of every LiveKit avatar adapter.
//
// Providers differ in how a session is OPENED (Tavus creates a conversation,
// Anam a session token + engine session) but not in how it is DRIVEN: once
// the avatar worker is in the room, agent PCM flows to it over one byte
// stream per utterance, barge-in is an RPC, and playback progress comes back
// as RPCs from the worker. That driving logic lives here, once, against the
// AvatarWire seam — subclasses implement only the provider handshake.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { AvatarAdapter, AvatarEvents, AvatarView } from "glove-voice-avatar";
import type { S2SAudioFormat } from "glove-voice-s2s";
import {
  type AvatarWire,
  type AvatarWireWriter,
  RPC_CLEAR_BUFFER,
  RPC_PLAYBACK_FINISHED,
  RPC_PLAYBACK_STARTED,
} from "./wire";

/** The rate the avatar datastream protocol carries — what LiveKit Agents'
 *  own plugins use, and what both Tavus and Anam expect. */
export const AVATAR_STREAM_RATE = 24_000;

export abstract class LiveKitAvatarSession
  extends EventEmitter<AvatarEvents>
  implements AvatarAdapter
{
  private _view: AvatarView | null = null;
  private connected = false;
  private writer: AvatarWireWriter | null = null;
  /** Serializes stream opens/writes/closes so frames never reorder. */
  private ops: Promise<void> = Promise.resolve();

  protected constructor(protected readonly wire: AvatarWire) {
    super();
  }

  /** Provider handshake: make the avatar worker join the room; return the
   *  view a CLIENT attaches to (for LiveKit avatars, the room itself). */
  protected abstract openSession(): Promise<AvatarView>;
  protected abstract closeSession(): Promise<void>;

  get view(): AvatarView | null {
    return this._view;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // Playback progress arrives as RPCs FROM the worker. `utterance_done` is
    // best-effort by contract; a worker that never calls back costs nothing.
    this.wire.onRpc(RPC_PLAYBACK_STARTED, () => "");
    this.wire.onRpc(RPC_PLAYBACK_FINISHED, (payload) => {
      let interrupted = false;
      try {
        interrupted = Boolean((JSON.parse(payload) as { interrupted?: boolean }).interrupted);
      } catch {
        /* absent/malformed payload → treat as a clean finish */
      }
      if (!interrupted) this.emit("utterance_done");
      return "";
    });
    this._view = await this.openSession();
    this.connected = true;
    this.emit("connected");
    this.emit("view_ready", this._view);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.ops = this.ops
      .then(async () => {
        const w = this.writer;
        this.writer = null;
        if (w) await w.close();
      })
      .catch(() => {});
    await this.ops.catch(() => {});
    await this.closeSession();
    this.emit("disconnected");
  }

  sendAudio(pcm: Int16Array, format: S2SAudioFormat): void {
    const at24k =
      format.sampleRate === AVATAR_STREAM_RATE
        ? pcm
        : resamplePcm(pcm, format.sampleRate, AVATAR_STREAM_RATE);
    const bytes = new Uint8Array(at24k.buffer.slice(at24k.byteOffset, at24k.byteOffset + at24k.byteLength));
    this.ops = this.ops
      .then(async () => {
        // One byte stream per utterance, opened lazily on the first chunk —
        // the stream's lifetime IS the utterance boundary on this protocol.
        if (!this.writer) {
          this.writer = await this.wire.openAudioStream({
            sampleRate: AVATAR_STREAM_RATE,
            channels: 1,
          });
        }
        await this.writer.write(bytes);
      })
      .catch((err) => {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      });
  }

  endUtterance(): void {
    // The writer only EXISTS inside the op chain (opens are async), so the
    // boundary must travel through the chain too — a synchronous look at
    // `this.writer` here races the open and silently merges utterances.
    this.ops = this.ops
      .then(async () => {
        const w = this.writer;
        this.writer = null;
        // Closing the stream is the flush: the worker's frame reassembler
        // emits any sub-frame remainder when the stream ends.
        if (w) await w.close();
      })
      .catch(() => {});
  }

  interrupt(): void {
    // Always safe, even with nothing in flight (conformance-enforced): drop
    // OUR unsent tail, then tell the worker to drop what it already has.
    this.ops = this.ops
      .then(async () => {
        const w = this.writer;
        this.writer = null;
        if (w) await w.close();
        await this.wire.performRpc(RPC_CLEAR_BUFFER, "");
      })
      .catch(() => {});
  }
}

/** Linear resample — good enough for speech; providers do their own filtering. */
export function resamplePcm(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const out = new Int16Array(Math.round((pcm.length * to) / from));
  const ratio = from / to;
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(pcm[i0] * (1 - frac) + pcm[i1] * frac);
  }
  return out;
}
