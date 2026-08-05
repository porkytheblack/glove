// ─────────────────────────────────────────────────────────────────────────────
// The avatar adapter contract.
//
// A realtime avatar provider is, at its core, a LIP-SYNC RENDERER over an
// audio stream: PCM in, a talking face out on some WebRTC surface. That is
// exactly the shape of the `audio` events a transport-mode S2SAdapter emits,
// which is why an avatar is a rendering LAYER over the voice stack rather
// than a replacement for it — the S2S model stays the front agent, the
// worker stays the capable model over the mesh, and the face subscribes to
// the same PCM the audio duct used to carry.
//
// What the contract deliberately does NOT cover: the user's microphone.
// Inbound audio keeps flowing through the host's own path to the S2S model
// (echo-style avatar pipelines have no STT/perception of their own), so the
// avatar is strictly one-directional — agent speech in, video out.
// ─────────────────────────────────────────────────────────────────────────────

import type EventEmitter from "eventemitter3";
import type { S2SAudioFormat } from "glove-voice-s2s";

/**
 * How a CLIENT attaches to the rendered avatar. Providers differ in kind, not
 * just URL — Tavus hands out a Daily room, Anam a session the browser SDK
 * turns into a WebRTC stream — so the shape is a tagged union the host
 * forwards to its client verbatim.
 */
export type AvatarView =
  /** Join (or embed) a WebRTC room by URL — e.g. Tavus's Daily room. The
   *  avatar's face AND voice both arrive through the room. */
  | { kind: "webrtc-room"; url: string; provider: string }
  /** Attach via the provider's browser SDK using a session credential —
   *  e.g. Anam's session token. */
  | { kind: "sdk-session"; sessionToken: string; provider: string };

export type AvatarEvents = {
  connected: [];
  disconnected: [];
  /** The provider session exists and a client can now attach. */
  view_ready: [view: AvatarView];
  /** The provider reported an utterance fully rendered (best-effort). */
  utterance_done: [];
  error: [err: Error];
};

/**
 * A live avatar session: agent PCM in, a talking face on a WebRTC surface.
 *
 * Mirrors `S2SAdapter`'s conventions — typed config on the constructor,
 * events for everything inbound, and interruption as a first-class,
 * conformance-enforced behaviour.
 */
export interface AvatarAdapter extends EventEmitter<AvatarEvents> {
  /** Open the provider session. Resolves once a client could attach;
   *  `view_ready` fires with the attach info (also readable via `view`). */
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** The attach info, once connected; null before. */
  readonly view: AvatarView | null;

  /**
   * Feed a chunk of the AGENT's speech. Chunks between `interrupt()` /
   * `endUtterance()` boundaries belong to one utterance; adapters buffer or
   * stream per their wire protocol.
   */
  sendAudio(pcm: Int16Array, format: S2SAudioFormat): void;

  /** The utterance finished cleanly (the S2S side went quiet). Flushes
   *  whatever the adapter buffered and closes the inference. */
  endUtterance(): void;

  /**
   * Barge-in: stop the face mid-word and drop anything buffered.
   *
   * MUST be safe to call at any time, including with nothing in flight —
   * the voice side treats every user speech-start as a potential
   * interruption, and the avatar must follow it. (Conformance-enforced.)
   */
  interrupt(): void;

  readonly isConnected: boolean;
}
