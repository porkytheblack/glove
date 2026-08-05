// ─────────────────────────────────────────────────────────────────────────────
// Tavus echo — the first concrete AvatarAdapter.
//
// Echo mode (`pipeline_mode: "echo"` on the PAL, created via /v2/pals)
// bypasses Tavus's whole CVI pipeline — Perception, STT, LLM, TTS — and
// streams OUR pre-generated audio straight into the rendered face. That is
// precisely the division of labour the layered architecture wants: the S2S
// model stays the brain and the voice, Tavus is the face. Consequences:
//   - No perception layer: the avatar does not see or hear the caller. The
//     caller's mic keeps flowing through the host's own duct to the S2S
//     model, exactly as before.
//   - Interruption logic is OURS. The voice side already treats every user
//     speech-start as a barge-in; this adapter forwards it as a
//     conversation.interrupt so the face stops with the voice.
//
// The session is a Tavus CONVERSATION (REST: pal_id + face_id in, a Daily
// room URL out — the adapter's `view`). Interaction events, though, are
// delivered EXCLUSIVELY over the Daily data channel (`sendAppMessage`) —
// there is no REST interactions endpoint — so the host MUST supply
// `sendInteraction`, a courier into the call. Two honest ways to build one:
//   - a browser already joined to the Daily room relays events the server
//     hands it (what examples/avatar-rooms does — the duct carries them);
//   - a server-side Daily SDK participant (e.g. daily-python) sends them
//     directly.
//
// Wire facts verified against docs.tavus.io (llms.txt index):
//   create   POST /v2/conversations  { pal_id, face_id, conversation_name? }
//   end      POST /v2/conversations/{id}/end
//   echo     { message_type, event_type: "conversation.echo", conversation_id,
//              properties: { modality: "audio", audio: <base64>,
//                            sample_rate: 24000, inference_id, done } }
//   interrupt{ message_type, event_type: "conversation.interrupt",
//              conversation_id }  — NO properties object
// ─────────────────────────────────────────────────────────────────────────────

import EventEmitter from "eventemitter3";
import type { S2SAudioFormat } from "glove-voice-s2s";
import type { AvatarAdapter, AvatarEvents, AvatarView } from "./types";

export interface TavusEchoConfig {
  /** Tavus API key (server-side only — never ships to a browser). */
  apiKey: string;
  /**
   * PAL with `pipeline_mode: "echo"`. OMIT to let the adapter ensure one:
   * it reuses (or creates) a MINIMAL echo PAL — no greeting, no TTS layer,
   * nothing that could speak in a voice that isn't the agent's. This is the
   * pattern every ecosystem integration uses (LiveKit creates its own echo
   * PAL; Pipecat ships a stock silent persona): a dashboard-created PAL
   * carries default greeting/voice configuration that talks over the echo
   * stream's opening in Tavus's OWN voice.
   */
  palId?: string;
  /** Name used when the adapter ensures its own echo PAL (default "glove-echo-pal"). */
  palName?: string;
  /** The face the PAL renders. Required by the conversations API. */
  faceId: string;
  /** Conversation display name, shown in the Daily room. */
  conversationName?: string;
  /**
   * The greeting Tavus speaks WITH ITS OWN TTS VOICE as the conversation
   * opens. Left unset, Tavus uses a stock greeting — which means the caller
   * hears a second, different voice before the first echo frame arrives.
   * Defaults to "" to suppress it: the agent's first words should come from
   * the S2S voice through echo. Set text only if you deliberately want a
   * provider-voiced opener. (A dashboard-created PAL can ALSO carry its own
   * greeting — the ensured minimal PAL is how you avoid that entirely.)
   */
  greeting?: string;
  /** API base (default https://tavusapi.com). */
  apiBase?: string;
  /** How much audio to batch per echo event (default 400ms). */
  chunkMs?: number;
  /** Inject the HTTP layer (conversation create/end) — proxies and tests. */
  fetchFn?: typeof fetch;
  /**
   * The interaction courier — REQUIRED, because Tavus interaction events
   * travel only over the Daily data channel (`sendAppMessage`), which this
   * adapter deliberately does not own. Forward each event into the call:
   * from a browser participant the host controls, or a server-side Daily
   * SDK participant.
   */
  sendInteraction: (event: Record<string, unknown>) => Promise<void> | void;
}

const TAVUS_RATE = 24_000;

/**
 * Reuse (or create) a MINIMAL echo PAL: `pipeline_mode: "echo"`, a default
 * face, and nothing else — no greeting, no TTS layer, no LLM defaults. This
 * is what keeps the conversation's opening silent until the first echo frame:
 * dashboard-created PALs carry defaults that speak in Tavus's own voice.
 * Matched by name so repeated boots don't accumulate PALs.
 */
export async function ensureEchoPal(opts: {
  apiKey: string;
  faceId: string;
  name?: string;
  apiBase?: string;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const doFetch = opts.fetchFn ?? fetch;
  const base = (opts.apiBase ?? "https://tavusapi.com").replace(/\/$/, "");
  const name = opts.name ?? "glove-echo-pal";
  const headers = { "x-api-key": opts.apiKey, "Content-Type": "application/json" };

  const list = await doFetch(`${base}/v2/pals`, { headers });
  if (list.ok) {
    const body = (await list.json()) as
      | Array<{ pal_id?: string; pal_name?: string }>
      | { data?: Array<{ pal_id?: string; pal_name?: string }> };
    const pals = Array.isArray(body) ? body : (body.data ?? []);
    const existing = pals.find((p) => p.pal_name === name && p.pal_id);
    if (existing?.pal_id) return existing.pal_id;
  }

  const created = await doFetch(`${base}/v2/pals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pal_name: name,
      default_face_id: opts.faceId,
      pipeline_mode: "echo",
    }),
  });
  if (!created.ok) {
    throw new Error(`Tavus PAL create failed (${created.status}): ${(await created.text()).slice(0, 300)}`);
  }
  const data = (await created.json()) as { pal_id?: string };
  if (!data.pal_id) throw new Error("Tavus PAL create returned no pal_id");
  return data.pal_id;
}

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
    if (typeof cfg.sendInteraction !== "function") {
      throw new Error(
        "TavusEchoAdapter needs `sendInteraction`: Tavus interaction events travel only over " +
          "the Daily data channel, so the host must supply a courier into the call " +
          "(a joined browser participant relaying events, or a server-side Daily SDK).",
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
    const palId =
      this.cfg.palId ??
      (await ensureEchoPal({
        apiKey: this.cfg.apiKey,
        faceId: this.cfg.faceId,
        name: this.cfg.palName,
        apiBase: this.cfg.apiBase,
        fetchFn: this.cfg.fetchFn,
      }));
    const res = await this.fetch(`${this.base()}/v2/conversations`, {
      method: "POST",
      headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        pal_id: palId,
        face_id: this.cfg.faceId,
        // Always sent: an absent custom_greeting means Tavus speaks a stock
        // one in its own voice over our echo stream's opening.
        custom_greeting: this.cfg.greeting ?? "",
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
      // End the conversation so the Daily room (and the meter) actually closes.
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
    // buffered tail or its inference identity (conformance-enforced). The
    // interrupt event carries NO properties, per the interactions protocol.
    this.resetUtterance();
    void this.deliver({
      message_type: "conversation",
      event_type: "conversation.interrupt",
      conversation_id: this.conversationId,
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
      await this.cfg.sendInteraction(event);
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
