// ─────────────────────────────────────────────────────────────────────────────
// Tavus echo — the first concrete AvatarAdapter.
//
// Echo mode (`pipeline_mode: "echo"` on the persona) bypasses Tavus's whole
// CVI pipeline — Perception, STT, LLM, TTS — and streams OUR pre-generated
// audio straight into the rendered face. That is precisely the division of
// labour the layered architecture wants: the S2S model stays the brain and
// the voice, Tavus is the face. Two consequences worth stating plainly:
//   - No perception layer: the avatar does not see or hear the caller. The
//     caller's mic keeps flowing through the host's own duct to the S2S
//     model, exactly as before.
//   - Interruption logic is OURS. The voice side already treats every user
//     speech-start as a barge-in; this adapter forwards it as an interrupt
//     interaction so the face stops with the voice.
//
// The session is a Tavus CONVERSATION created over REST; the caller joins
// its Daily room (the adapter's `view`) to see and hear the avatar. Audio
// goes up as base64 24 kHz PCM `conversation.echo` interaction events.
//
// Verification honesty, same as every adapter in this series: conformance
// proves the wiring against our reading of the protocol; only a live call
// with credentials proves the reading. The interaction TRANSPORT is
// injectable (`sendInteraction`) because that is the part of the protocol a
// live test is most likely to move — e.g. onto the Daily data channel.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { S2SAudioFormat } from "glove-voice-s2s";
import type { AvatarAdapter, AvatarEvents, AvatarView } from "./types";

export interface TavusEchoConfig {
  /** Tavus API key (server-side only — never ships to a browser). */
  apiKey: string;
  /** Persona with `pipeline_mode: "echo"`. */
  personaId: string;
  /** Replica (the face). Optional when the persona carries a default. */
  replicaId?: string;
  /** Conversation display name, shown in the Daily room. */
  conversationName?: string;
  /** API base (default https://tavusapi.com). */
  apiBase?: string;
  /** How much audio to batch per echo event (default 400ms). */
  chunkMs?: number;
  /** Inject the HTTP layer — proxies and tests. */
  fetchFn?: typeof fetch;
  /**
   * Inject the interaction transport. Default POSTs to the conversation's
   * interactions endpoint; a host already holding a Daily connection can
   * route events over the data channel instead.
   */
  sendInteraction?: (event: Record<string, unknown>) => Promise<void>;
}

const TAVUS_RATE = 24_000;

export class TavusEchoAdapter extends EventEmitter<AvatarEvents> implements AvatarAdapter {
  private connected = false;
  private conversationId: string | null = null;
  private _view: AvatarView | null = null;

  /** Current utterance: buffered samples at 24 kHz + its inference identity. */
  private buffer: Int16Array[] = [];
  private buffered = 0;
  private inferenceSeq = 0;
  private inferenceId: string | null = null;

  constructor(private readonly cfg: TavusEchoConfig) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get view(): AvatarView | null {
    return this._view;
  }

  async connect(): Promise<void> {
    const res = await this.fetch(`${this.base()}/v2/conversations`, {
      method: "POST",
      headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        persona_id: this.cfg.personaId,
        ...(this.cfg.replicaId ? { replica_id: this.cfg.replicaId } : {}),
        ...(this.cfg.conversationName ? { conversation_name: this.cfg.conversationName } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Tavus conversation create failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { conversation_id?: string; conversation_url?: string };
    if (!data.conversation_id || !data.conversation_url) {
      throw new Error("Tavus conversation create returned no id/url");
    }
    this.conversationId = data.conversation_id;
    this._view = { kind: "webrtc-room", url: data.conversation_url, provider: "tavus" };
    this.connected = true;
    this.emit("connected");
    this.emit("view_ready", this._view);
  }

  async disconnect(): Promise<void> {
    const id = this.conversationId;
    this.connected = false;
    this.conversationId = null;
    this.resetUtterance();
    if (id) {
      // End the conversation so the room (and the meter) actually closes.
      await this.fetch(`${this.base()}/v2/conversations/${id}/end`, {
        method: "POST",
        headers: { "x-api-key": this.cfg.apiKey },
      }).catch(() => {
        /* already gone */
      });
    }
    this.emit("disconnected");
  }

  sendAudio(pcm: Int16Array, format: S2SAudioFormat): void {
    if (!this.connected) return;
    const at24k = format.sampleRate === TAVUS_RATE ? pcm : resample(pcm, format.sampleRate, TAVUS_RATE);
    if (!this.inferenceId) this.inferenceId = `inf-${++this.inferenceSeq}`;
    this.buffer.push(at24k);
    this.buffered += at24k.length;
    const chunkSamples = (TAVUS_RATE * (this.cfg.chunkMs ?? 400)) / 1000;
    if (this.buffered >= chunkSamples) void this.flush(false);
  }

  endUtterance(): void {
    if (!this.connected || !this.inferenceId) return;
    void this.flush(true);
  }

  interrupt(): void {
    if (!this.connected) return;
    // Drop the cut sentence entirely — the next reply must not inherit its
    // buffered tail or its inference identity (conformance-enforced).
    const interrupted = this.inferenceId;
    this.resetUtterance();
    void this.deliver({
      message_type: "conversation",
      event_type: "conversation.interrupt",
      conversation_id: this.conversationId,
      ...(interrupted ? { properties: { inference_id: interrupted } } : {}),
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private resetUtterance(): void {
    this.buffer = [];
    this.buffered = 0;
    this.inferenceId = null;
  }

  private async flush(done: boolean): Promise<void> {
    const inferenceId = this.inferenceId;
    if (!inferenceId) return;
    const joined = concat(this.buffer, this.buffered);
    this.buffer = [];
    this.buffered = 0;
    if (done) this.inferenceId = null;
    if (joined.length === 0 && !done) return;
    await this.deliver({
      message_type: "conversation",
      event_type: "conversation.echo",
      conversation_id: this.conversationId,
      properties: {
        modality: "audio",
        audio: int16ToBase64(joined),
        sample_rate: TAVUS_RATE,
        inference_id: inferenceId,
        done,
      },
    });
    if (done) this.emit("utterance_done");
  }

  private async deliver(event: Record<string, unknown>): Promise<void> {
    try {
      if (this.cfg.sendInteraction) {
        await this.cfg.sendInteraction(event);
        return;
      }
      const res = await this.fetch(
        `${this.base()}/v2/conversations/${this.conversationId}/interactions`,
        {
          method: "POST",
          headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(event),
        },
      );
      if (!res.ok) {
        this.emit("error", new Error(`Tavus interaction rejected (${res.status})`));
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private base(): string {
    return (this.cfg.apiBase ?? "https://tavusapi.com").replace(/\/$/, "");
  }

  private get fetch(): typeof fetch {
    return this.cfg.fetchFn ?? fetch;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function concat(chunks: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Linear resample — good enough for speech; providers do their own filtering. */
function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const outLen = Math.floor((pcm.length * to) / from);
  const out = new Int16Array(outLen);
  const ratio = from / to;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = (pcm[i0] * (1 - frac) + pcm[i1] * frac) | 0;
  }
  return out;
}

// Pure JS base64 — Node, browser, RN alike (same rationale as glove-voice-s2s).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}
