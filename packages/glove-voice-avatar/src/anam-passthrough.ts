// ─────────────────────────────────────────────────────────────────────────────
// Anam passthrough — the second concrete AvatarAdapter.
//
// Anam's audio-passthrough mode (`enableAudioPassthrough: true` on the
// persona config) bypasses its LLM and TTS layers and lip-syncs the face to
// audio WE provide — the same division of labour as Tavus echo: the S2S
// model stays the brain and the voice, Anam is the face.
//
// The wire is shaped by where Anam's session lives: the BROWSER. The server
// only mints a session token (with the passthrough flag baked in); the
// client SDK (`@anam-ai/js-sdk`) opens the WebRTC session, renders the
// video, and — crucially — owns the audio input stream
// (`createAgentAudioInputStream`). There is no server-side audio API in
// this mode. So, exactly like the Tavus adapter's `sendInteraction`, the
// host MUST supply `sendCommand`: a courier that forwards this adapter's
// commands to the joined browser, which applies them to the SDK:
//
//   { type: "audio_chunk", audio }  → audioInputStream.sendAudioChunk(audio)
//   { type: "end_sequence" }        → audioInputStream.endSequence()
//   { type: "interrupt" }           → anamClient.interruptPersona()
//                                     + audioInputStream.endSequence()
//
// Wire facts verified against anam.ai/docs (llms.txt index):
//   token   POST /v1/auth/session-token   Authorization: Bearer <api key>
//           { personaConfig: { name, avatarId, avatarModel,
//                              enableAudioPassthrough: true } }
//           → { sessionToken } — the client boots the session from it
//   audio   pcm_s16le, 16 kHz, mono, base64 chunks; endSequence() closes an
//           utterance; interruptPersona() stops lip-sync immediately, and
//           endSequence() with it drops the buffered tail.
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { S2SAudioFormat } from "glove-voice-s2s";
import type { AvatarAdapter, AvatarEvents, AvatarView } from "./types";

/** What the courier ferries to the browser holding the Anam SDK session. */
export type AnamClientCommand =
  /** Base64 pcm_s16le @ 16 kHz mono → `audioInputStream.sendAudioChunk`. */
  | { type: "audio_chunk"; audio: string }
  /** The utterance is complete → `audioInputStream.endSequence()`. */
  | { type: "end_sequence" }
  /** Barge-in → `interruptPersona()` + `endSequence()`. */
  | { type: "interrupt" };

export interface AnamPassthroughConfig {
  /** Anam API key (server-side only — never ships to a browser; the browser
   *  gets the short-lived session token instead). */
  apiKey: string;
  /** The Anam avatar to render. */
  avatarId: string;
  /**
   * Avatar model generation. Defaults to "cara-4" — the generation Anam's
   * passthrough documentation targets. Override as Anam ships new ones.
   */
  avatarModel?: string;
  /** Persona display name; cosmetic. */
  name?: string;
  /**
   * Session lifetime cap, seconds (default 3600). NOTE: Anam's PLAN limit
   * wins regardless — conversations are force-ended at 3/5/10 minutes on
   * Free/Starter/Explorer (unlimited on Growth+), closing the connection
   * with SERVER_CLOSED_CONNECTION. Hosts should treat that as routine and
   * renew: disconnect() + connect() mints a fresh session, and the client
   * re-attaches from the new view (examples/avatar-rooms does exactly
   * this on its `avatar_refresh` round trip).
   */
  maxSessionLengthSeconds?: number;
  /**
   * Silence window before Anam auto-ends the session, seconds (default
   * 7200, the documented maximum — effectively off). It MUST be long here:
   * in passthrough the avatar hears nothing by design (the caller's mic
   * goes up the host's duct, and the agent only sends audio while
   * speaking), so every conversational pause reads as "silence" to Anam
   * and a short window kills healthy calls.
   */
  silenceBeforeSessionEndSeconds?: number;
  /** API base (default https://api.anam.ai). */
  apiBase?: string;
  /** How much audio to batch per audio_chunk command (default 400ms). */
  chunkMs?: number;
  /** Inject the HTTP layer (session-token mint) — proxies and tests. */
  fetchFn?: typeof fetch;
  /**
   * The command courier — REQUIRED, because Anam's passthrough audio input
   * lives on the client SDK, which this adapter deliberately does not own.
   * Forward each command to the browser that booted the session from
   * `view.sessionToken` (examples/avatar-rooms carries them down its duct).
   */
  sendCommand: (command: AnamClientCommand) => Promise<void> | void;
}

/** The rate Anam's passthrough input stream expects. */
const ANAM_RATE = 16_000;

export class AnamPassthroughAdapter extends EventEmitter<AvatarEvents> implements AvatarAdapter {
  private connected = false;
  private _view: AvatarView | null = null;

  /** Current utterance: buffered samples at 16 kHz; whether any were sent. */
  private buffer: Int16Array[] = [];
  private buffered = 0;
  private utteranceOpen = false;

  constructor(private readonly cfg: AnamPassthroughConfig) {
    super();
    if (typeof cfg.sendCommand !== "function") {
      throw new Error(
        "AnamPassthroughAdapter needs `sendCommand`: Anam's passthrough audio input lives on the " +
          "browser SDK session, so the host must supply a courier to the joined client " +
          "(sendAudioChunk / endSequence / interruptPersona are client-side calls).",
      );
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get view(): AvatarView | null {
    return this._view;
  }

  async connect(): Promise<void> {
    const doFetch = this.cfg.fetchFn ?? fetch;
    const res = await doFetch(`${this.base()}/v1/auth/session-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personaConfig: {
          name: this.cfg.name ?? "glove-avatar",
          avatarId: this.cfg.avatarId,
          avatarModel: this.cfg.avatarModel ?? "cara-4",
          // The whole point: OUR audio drives the face; Anam's LLM and TTS
          // stay out of the loop.
          enableAudioPassthrough: true,
          maxSessionLengthSeconds: this.cfg.maxSessionLengthSeconds ?? 3_600,
          voiceDetectionOptions: {
            // The avatar hears nothing by design, so silence-based session
            // ending would kill every healthy call at the first long pause.
            silenceBeforeSessionEndSeconds: this.cfg.silenceBeforeSessionEndSeconds ?? 7_200,
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Anam session token failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { sessionToken?: string };
    if (!data.sessionToken) throw new Error("Anam returned no sessionToken");

    // The view is the token: the browser boots the session with
    // createClient(sessionToken, { disableInputAudio: true }) and streams the
    // face into a <video>. (disableInputAudio because the caller's mic goes
    // up the host's own duct to the S2S model — the avatar must not hear.)
    this._view = { kind: "sdk-session", sessionToken: data.sessionToken, provider: "anam" };
    this.connected = true;
    this.emit("connected");
    this.emit("view_ready", this._view);
  }

  async disconnect(): Promise<void> {
    // No server-side end call in this mode: the session dies with the client
    // (stopStreaming) or the token's TTL. Just stop claiming it's alive.
    this.connected = false;
    this.resetUtterance();
    this._view = null;
    this.emit("disconnected");
  }

  sendAudio(pcm: Int16Array, format: S2SAudioFormat): void {
    if (!this.connected) return;
    const at16k = format.sampleRate === ANAM_RATE ? pcm : resample(pcm, format.sampleRate, ANAM_RATE);
    this.utteranceOpen = true;
    this.buffer.push(at16k);
    this.buffered += at16k.length;
    const chunkSamples = (ANAM_RATE * (this.cfg.chunkMs ?? 400)) / 1000;
    if (this.buffered >= chunkSamples) this.flushBuffered();
  }

  endUtterance(): void {
    if (!this.connected || !this.utteranceOpen) return;
    this.flushBuffered();
    this.utteranceOpen = false;
    void this.deliver({ type: "end_sequence" });
    this.emit("utterance_done");
  }

  interrupt(): void {
    if (!this.connected) return;
    // Drop the cut sentence's unsent tail; the browser side pairs
    // interruptPersona() with endSequence() so Anam drops ITS buffer too.
    // The next reply starts a fresh sequence (conformance-enforced).
    this.resetUtterance();
    void this.deliver({ type: "interrupt" });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private resetUtterance(): void {
    this.buffer = [];
    this.buffered = 0;
    this.utteranceOpen = false;
  }

  private flushBuffered(): void {
    if (this.buffered === 0) return;
    const joined = concat(this.buffer, this.buffered);
    this.buffer = [];
    this.buffered = 0;
    void this.deliver({ type: "audio_chunk", audio: int16ToBase64(joined) });
  }

  private async deliver(command: AnamClientCommand): Promise<void> {
    try {
      await this.cfg.sendCommand(command);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private base(): string {
    return (this.cfg.apiBase ?? "https://api.anam.ai").replace(/\/$/, "");
  }
}

// ── helpers (same speech-grade primitives as the Tavus adapter) ──────────────

function concat(chunks: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

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
