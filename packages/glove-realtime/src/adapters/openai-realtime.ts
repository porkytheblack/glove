// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Realtime (gpt-realtime) over WebSocket.
//
// The provider keeps a MUTABLE conversation: items can be created with ids we
// choose and deleted later. That is what makes this adapter the most capable
// one here —
//
//   - a keyed injection deletes its previous item before adding the new one,
//     so a runtime-context snapshot supersedes the last one instead of
//     piling up beside it;
//   - compact() deletes every tracked item and puts the summary (and the
//     recent turns) back, in place, without dropping the call;
//   - summarize() runs an out-of-band response (`conversation: "none"`) that
//     reads the conversation but never enters it, so the model that heard
//     the call writes the summary of it.
//
// Audio is 24 kHz PCM16 both ways. Auth rides the `openai-insecure-api-key`
// subprotocol, since the spec WebSocket (browser, Node 22+) can't set
// headers: hand it an ephemeral client secret in a browser, the API key only
// on a server.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  RealtimeAdapter,
  RealtimeAudioFormat,
  RealtimeCapabilities,
  RealtimeCompaction,
  RealtimeCompactionOutcome,
  RealtimeHistoryItem,
  RealtimeInjection,
  RealtimeMedia,
  RealtimeSessionSpec,
  RealtimeToolResult,
  RealtimeToolSpec,
  RealtimeUsage,
} from "../types";
import {
  AdapterBase,
  asError,
  awaitOpen,
  base64ToInt16,
  decodeFrame,
  defaultSocket,
  int16ToBase64,
  mediaBase64,
  type WebSocketLike,
} from "../wire";

/** Model-judged end of turn: scores whether the speaker was DONE, not just quiet. */
export interface OpenAISemanticVad {
  type: "semantic_vad";
  /** How quickly the model takes the floor. `low` lets slow talkers finish. */
  eagerness?: "low" | "medium" | "high" | "auto";
  create_response?: boolean;
  /** `false`: the agent always finishes its sentence; barge-in is off. */
  interrupt_response?: boolean;
}

/** Threshold-driven end of turn: volume and silence. */
export interface OpenAIServerVad {
  type: "server_vad";
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  idle_timeout_ms?: number;
  create_response?: boolean;
  interrupt_response?: boolean;
}

/** `null`: push-to-talk. The host commits audio and asks for responses. */
export type OpenAITurnDetection = OpenAISemanticVad | OpenAIServerVad | null;

export interface OpenAIRealtimeConfig {
  /** Ephemeral client secret (browser) or API key (server only). */
  getToken: () => Promise<string> | string;
  /** Default "gpt-realtime". */
  model?: string;
  /** Fallback voice when the session spec names none. */
  voice?: string;
  /** Default wss://api.openai.com/v1/realtime. */
  url?: string;
  /** Input transcription model. `null` turns user transcripts off. Default gpt-4o-mini-transcribe. */
  transcriptionModel?: string | null;
  /** Default semantic VAD. */
  turnDetection?: OpenAITurnDetection;
  noiseReduction?: "near_field" | "far_field" | null;
  /**
   * The provider's own window management (gpt-realtime truncates the oldest
   * turns when full). Unset is the API default; `retention_ratio` truncates
   * further in one go, which keeps the prompt cache warmer on long calls.
   */
  truncation?: "auto" | "disabled" | { type: "retention_ratio"; retention_ratio: number };
  connectTimeoutMs?: number;
  /** How long summarize() waits for its out-of-band response. Default 30 s. */
  summarizeTimeoutMs?: number;
  socketFactory?: (url: string, protocols: string[]) => WebSocketLike;
}

const PCM24: RealtimeAudioFormat = { sampleRate: 24_000, channels: 1, encoding: "pcm_s16le" };

type Wire = { type?: string; [key: string]: any };

let counter = 0;
/** Client-chosen item ids (≤ 32 chars) so items can be deleted without
 *  waiting for the server to echo them. */
function itemId(): string {
  counter = (counter + 1) % 1_000_000;
  return `glv_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
}

export class OpenAIRealtimeAdapter extends AdapterBase implements RealtimeAdapter {
  readonly provider = "openai";
  readonly model: string;
  readonly inputFormat = PCM24;
  readonly outputFormat = PCM24;
  readonly capabilities: RealtimeCapabilities = {
    input: ["audio", "text", "image"],
    output: ["audio", "text"],
    tools: { update: "live", nonBlocking: false, cancellation: false },
    instructions: { update: "replace" },
    context: { silentInjection: true, supersede: true, historySeed: true },
    compaction: { native: true, apply: "in_place", summarize: true },
    resumption: false,
    transcripts: "turns",
    speechLifecycle: "provider",
  };

  private ws: WebSocketLike | null = null;
  private opened = false;
  private expectClose = false;
  private generation = 0;
  /** Conversation items in order, as the server reported them. */
  private items: string[] = [];
  /** Injection key → the item that currently carries it. */
  private keyed = new Map<string, string>();
  /** Out-of-band responses (summaries) — their output must not surface as speech or text. */
  private outOfBand = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  private outOfBandResponses = new Set<string>();
  private speaking = false;
  private transcript = "";
  private text = "";
  /** The item being spoken, for syncing the model to what was actually heard. */
  private spokenItem: { id: string; emittedMs: number; firstDeltaAt: number } | null = null;

  constructor(private readonly cfg: OpenAIRealtimeConfig) {
    super();
    this.model = cfg.model ?? "gpt-realtime";
  }

  get isOpen(): boolean {
    return this.opened;
  }

  async open(spec: RealtimeSessionSpec): Promise<void> {
    if (this.opened) return;
    const generation = ++this.generation;
    this.spec = { ...spec };
    this.expectClose = false;
    this.items = [];
    this.keyed.clear();

    const token = await this.cfg.getToken();
    const base = (this.cfg.url ?? "wss://api.openai.com/v1/realtime").replace(/\/$/, "");
    const url = `${base}?model=${encodeURIComponent(this.model)}`;
    const protocols = ["realtime", `openai-insecure-api-key.${token}`];
    const ws = this.cfg.socketFactory ? this.cfg.socketFactory(url, protocols) : defaultSocket(url, protocols);
    this.ws = ws;

    let acknowledge!: () => void;
    let refuse!: (error: Error) => void;
    const accepted = new Promise<void>((resolve, reject) => {
      acknowledge = resolve;
      refuse = reject;
    });
    let pending = true;

    ws.addEventListener("message", (ev: { data: unknown }) => {
      if (generation !== this.generation) return;
      decodeFrame(ev.data, (text) => {
        let event: Wire;
        try {
          event = JSON.parse(text);
        } catch {
          return;
        }
        if (pending && event.type === "session.updated") {
          pending = false;
          acknowledge();
          return;
        }
        if (pending && event.type === "error") {
          pending = false;
          refuse(new Error(`OpenAI Realtime rejected the session: ${event.error?.message ?? "unknown error"}`));
          return;
        }
        this.handle(event);
      });
    });
    ws.addEventListener("close", (ev: { code?: number; reason?: string }) => {
      if (generation !== this.generation) return;
      if (pending) {
        pending = false;
        refuse(new Error(`OpenAI Realtime closed during setup (${ev?.code ?? "?"})${ev?.reason ? `: ${ev.reason}` : ""}`));
      }
      this.release(ev?.reason || (ev?.code !== undefined ? `closed (${ev.code})` : undefined));
    });
    ws.addEventListener("error", () => {
      if (generation === this.generation && this.opened) this.fail("OpenAI Realtime socket error");
    });

    const timeoutMs = this.cfg.connectTimeoutMs ?? 15_000;
    try {
      await awaitOpen(ws, timeoutMs, "OpenAI Realtime");
      this.send({ type: "session.update", session: this.sessionPayload(this.spec, true) });
      await Promise.race([
        accepted,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("OpenAI Realtime session setup timed out")), timeoutMs),
        ),
      ]);
    } catch (error) {
      pending = false;
      ++this.generation;
      this.ws = null;
      try { ws.close(); } catch { /* already closed */ }
      throw asError(error);
    }

    this.opened = true;
    for (const item of spec.history ?? []) this.createMessage(item.role, item.text);
    this.emit({ type: "session.opened", resumed: false });
  }

  async close(): Promise<void> {
    if (!this.ws) return;
    this.expectClose = true;
    const ws = this.ws;
    try { ws.close(1000, "closed by client"); } catch { /* already closed */ }
    // Don't wait on the close handshake: release now, ignore the late echo.
    ++this.generation;
    this.release("closed by client");
  }

  private release(reason?: string): void {
    const wasOpen = this.opened || this.ws !== null;
    const expected = this.expectClose;
    this.ws = null;
    this.opened = false;
    this.expectClose = false;
    this.speaking = false;
    this.spokenItem = null;
    for (const pending of this.outOfBand.values()) pending.reject(new Error("OpenAI Realtime session closed"));
    this.outOfBand.clear();
    this.outOfBandResponses.clear();
    if (wasOpen) this.emit({ type: "session.closed", expected, ...(reason ? { reason } : {}) });
  }

  // ── input ─────────────────────────────────────────────────────────────────

  sendAudio(pcm: Int16Array): void {
    if (this.opened) this.send({ type: "input_audio_buffer.append", audio: int16ToBase64(pcm) });
  }

  sendText(text: string, opts?: { respond?: boolean }): void {
    this.createMessage("user", text);
    if (opts?.respond !== false) this.send({ type: "response.create" });
  }

  sendMedia(media: RealtimeMedia): void {
    if (media.kind !== "image") {
      // Each frame would become a conversation item and the window would be
      // gone in seconds. Send selected frames as images instead.
      throw new Error("OpenAI Realtime has no video input: send selected frames as images (kind: \"image\").");
    }
    this.send({
      type: "conversation.item.create",
      item: {
        id: itemId(),
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: `data:${media.mimeType};base64,${mediaBase64(media)}` }],
      },
    });
  }

  // ── provider-owned agent concerns ─────────────────────────────────────────

  setTools(tools: RealtimeToolSpec[]): void {
    this.spec = { ...this.spec, tools };
    if (this.opened) this.send({ type: "session.update", session: this.sessionPayload({ tools }, false) });
  }

  setInstructions(instructions: string): void {
    this.spec = { ...this.spec, instructions };
    if (this.opened) this.send({ type: "session.update", session: this.sessionPayload({ instructions }, false) });
  }

  inject(injection: RealtimeInjection): void {
    if (!this.opened) return;
    if (injection.key) {
      const previous = this.keyed.get(injection.key);
      if (previous) this.send({ type: "conversation.item.delete", item_id: previous });
    }
    const id = this.createMessage(injection.kind === "user" ? "user" : "system", injection.text);
    if (injection.key) this.keyed.set(injection.key, id);
    const respond = injection.respond ?? injection.kind === "user";
    if (respond) this.send({ type: "response.create" });
  }

  sendToolResult(result: RealtimeToolResult): void {
    if (!this.opened) return;
    this.send({
      type: "conversation.item.create",
      item: {
        id: itemId(),
        type: "function_call_output",
        call_id: result.callId,
        output: typeof result.output === "string" ? result.output : (JSON.stringify(result.output) ?? "null"),
      },
    });
    if (result.respond !== false && result.scheduling !== "silent") this.send({ type: "response.create" });
  }

  respond(opts?: { instructions?: string }): void {
    if (!this.opened) return;
    // Not `response.instructions`: that REPLACES the session prompt for the
    // response, persona included. A system item adds to it instead.
    if (opts?.instructions) this.createMessage("system", opts.instructions);
    this.send({ type: "response.create" });
  }

  interrupt(): void {
    this.send({ type: "response.cancel" });
    this.truncateToHeard();
    this.flushOutput();
  }

  async compact(request: RealtimeCompaction): Promise<RealtimeCompactionOutcome> {
    if (!this.opened) return "unsupported";
    for (const id of this.items) this.send({ type: "conversation.item.delete", item_id: id });
    this.items = [];
    this.keyed.clear();
    this.createMessage("system", `Summary of the conversation so far:\n${request.summary}`);
    for (const item of request.recent ?? []) this.createMessage(item.role, item.text);
    this.emit({ type: "context.compacted", mode: "in_place" });
    return "in_place";
  }

  summarize(instructions: string): Promise<string> {
    if (!this.opened) return Promise.reject(new Error("OpenAI Realtime session is not open"));
    const tag = itemId();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.outOfBand.delete(tag);
        reject(new Error("OpenAI Realtime summary timed out"));
      }, this.cfg.summarizeTimeoutMs ?? 30_000);
      this.outOfBand.set(tag, {
        resolve: (text) => { clearTimeout(timer); resolve(text); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.send({
        type: "response.create",
        response: {
          conversation: "none",
          output_modalities: ["text"],
          instructions,
          metadata: { glove_request: tag },
        },
      });
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private send(event: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(event));
  }

  private createMessage(role: RealtimeHistoryItem["role"], text: string): string {
    const id = itemId();
    this.send({
      type: "conversation.item.create",
      item: {
        id,
        type: "message",
        role,
        content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
      },
    });
    return id;
  }

  /** `full` is the first-frame setup; patches carry only what changed (a
   *  voice is locked once the model has spoken, so it is never re-sent). */
  private sessionPayload(spec: RealtimeSessionSpec, full: boolean): Record<string, unknown> {
    const session: Record<string, unknown> = { type: "realtime" };
    if (spec.instructions !== undefined) session.instructions = spec.instructions;
    if (spec.tools !== undefined) {
      session.tools = spec.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
      session.tool_choice = "auto";
    }
    if (!full) return session;

    session.output_modalities = [spec.output ?? "audio"];
    if (this.cfg.truncation !== undefined) session.truncation = this.cfg.truncation;
    const input: Record<string, unknown> = {
      format: { type: "audio/pcm", rate: PCM24.sampleRate },
      // `null` is a real value (push-to-talk); only UNSET defaults.
      turn_detection: this.cfg.turnDetection !== undefined ? this.cfg.turnDetection : { type: "semantic_vad" },
    };
    if (this.cfg.transcriptionModel !== null) {
      input.transcription = { model: this.cfg.transcriptionModel ?? "gpt-4o-mini-transcribe" };
    }
    if (this.cfg.noiseReduction) input.noise_reduction = { type: this.cfg.noiseReduction };
    const output: Record<string, unknown> = { format: { type: "audio/pcm", rate: PCM24.sampleRate } };
    const voice = spec.voice ?? this.cfg.voice;
    if (voice) output.voice = voice;
    session.audio = { input, output };
    return session;
  }

  private flushOutput(): void {
    const wasSpeaking = this.speaking;
    this.speaking = false;
    this.transcript = "";
    this.text = "";
    // Always: the host's playback queue usually still holds audio after the
    // provider finished generating it. Gating this on `speaking` is how
    // barge-in silently stops working.
    this.emit({ type: "interrupted" });
    if (wasSpeaking) this.emit({ type: "output.speech_stopped" });
  }

  /**
   * Rewrite the interrupted reply to what the caller HEARD. Audio generates
   * faster than it plays, so without this the model believes it delivered
   * the whole reply and never repeats the part that was cut. Heard ≈ wall
   * clock since the first delta, clamped to what was emitted.
   */
  private truncateToHeard(): void {
    const item = this.spokenItem;
    this.spokenItem = null;
    if (!item || item.emittedMs <= 0) return;
    const elapsed = Date.now() - item.firstDeltaAt;
    if (elapsed >= item.emittedMs) return;
    this.send({ type: "conversation.item.truncate", item_id: item.id, content_index: 0, audio_end_ms: Math.max(0, Math.round(elapsed)) });
  }

  private bargeInEnabled(): boolean {
    const td = this.cfg.turnDetection;
    return !(td && td.interrupt_response === false);
  }

  private handle(e: Wire): void {
    const responseId: string | undefined = e.response_id ?? e.response?.id;
    if (responseId && this.outOfBandResponses.has(responseId) && e.type !== "response.done") return;

    switch (e.type) {
      case "conversation.item.added":
      case "conversation.item.created": {
        const id = e.item?.id;
        if (typeof id === "string" && !this.items.includes(id)) this.items.push(id);
        break;
      }
      case "conversation.item.deleted":
        this.items = this.items.filter((id) => id !== e.item_id);
        break;

      case "input_audio_buffer.speech_started":
        this.emit({ type: "input.speech_started" });
        if (this.bargeInEnabled()) {
          // The provider can't see the host's playback queue, so user speech
          // is always a potential interruption: cancel, sync, flush.
          this.send({ type: "response.cancel" });
          this.truncateToHeard();
          this.flushOutput();
        }
        break;
      case "input_audio_buffer.speech_stopped":
        this.emit({ type: "input.speech_stopped" });
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (e.delta) this.emit({ type: "input.transcript", text: String(e.delta), final: false });
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit({ type: "input.transcript", text: String(e.transcript ?? ""), final: true });
        break;

      case "response.created": {
        const tag = e.response?.metadata?.glove_request;
        if (typeof tag === "string" && this.outOfBand.has(tag)) {
          this.outOfBandResponses.add(String(e.response.id));
          break;
        }
        this.emit({ type: "response.started", ...(e.response?.id ? { responseId: String(e.response.id) } : {}) });
        break;
      }

      case "response.output_audio.delta":
      case "response.audio.delta": {
        const pcm = base64ToInt16(String(e.delta ?? ""));
        const id = String(e.item_id ?? "");
        if (id) {
          if (this.spokenItem?.id !== id) this.spokenItem = { id, emittedMs: 0, firstDeltaAt: Date.now() };
          this.spokenItem.emittedMs += (pcm.length * 1000) / PCM24.sampleRate;
        }
        if (!this.speaking) {
          this.speaking = true;
          this.emit({ type: "output.speech_started" });
        }
        this.emit({ type: "output.audio", pcm, format: PCM24 });
        break;
      }
      case "response.output_audio.done":
      case "response.audio.done":
        if (this.speaking) {
          this.speaking = false;
          this.emit({ type: "output.speech_stopped" });
        }
        break;

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const delta = String(e.delta ?? "");
        this.transcript += delta;
        this.emit({ type: "output.transcript", text: delta, final: false });
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.emit({ type: "output.transcript", text: String(e.transcript ?? this.transcript), final: true });
        this.transcript = "";
        break;

      case "response.output_text.delta":
      case "response.text.delta": {
        const delta = String(e.delta ?? "");
        this.text += delta;
        this.emit({ type: "output.text", text: delta, final: false });
        break;
      }
      case "response.output_text.done":
      case "response.text.done":
        this.emit({ type: "output.text", text: String(e.text ?? this.text), final: true });
        this.text = "";
        break;

      case "response.function_call_arguments.done":
        this.emit({
          type: "tool.call",
          callId: String(e.call_id ?? ""),
          name: String(e.name ?? ""),
          arguments: String(e.arguments ?? "{}"),
        });
        break;

      case "response.done":
        this.onResponseDone(e.response ?? {});
        break;

      case "error": {
        const error = (e.error ?? {}) as { message?: string; code?: string };
        // Cancelling with nothing in flight, or deleting an item the provider
        // already truncated away, is not a failure.
        if (error.code === "response_cancel_not_active" || error.code === "item_not_found") break;
        this.fail(error.message ?? "OpenAI Realtime error");
        break;
      }
    }
  }

  private onResponseDone(response: Wire): void {
    const usage = response.usage ? toUsage(response.usage) : undefined;
    const tag = response.metadata?.glove_request;
    if (typeof tag === "string" && this.outOfBand.has(tag)) {
      const pending = this.outOfBand.get(tag)!;
      this.outOfBand.delete(tag);
      this.outOfBandResponses.delete(String(response.id));
      if (usage) this.emit({ type: "usage", usage });
      if (response.status && response.status !== "completed") {
        pending.reject(new Error(`OpenAI Realtime summary ${response.status}`));
      } else {
        pending.resolve(outputText(response));
      }
      return;
    }
    if (this.speaking) {
      this.speaking = false;
      this.emit({ type: "output.speech_stopped" });
    }
    const reason = response.status_details?.reason;
    const status =
      response.status === "cancelled" && reason === "turn_detected" ? "interrupted"
      : response.status === "cancelled" || response.status === "failed" || response.status === "incomplete" ? response.status
      : "completed";
    if (status === "failed") this.fail(response.status_details?.error?.message ?? "OpenAI Realtime response failed");
    this.emit({
      type: "response.done",
      status,
      ...(response.id ? { responseId: String(response.id) } : {}),
      ...(usage ? { usage } : {}),
    });
    if (usage) this.emit({ type: "usage", usage });
  }
}

function toUsage(raw: Wire): RealtimeUsage {
  const tokensIn = Number(raw.input_tokens ?? 0);
  const tokensOut = Number(raw.output_tokens ?? 0);
  const inDetails = raw.input_token_details ?? {};
  const outDetails = raw.output_token_details ?? {};
  return {
    tokensIn,
    tokensOut,
    ...(inDetails.cached_tokens != null ? { cachedTokensIn: Number(inDetails.cached_tokens) } : {}),
    byModality: {
      in: pick({ text: inDetails.text_tokens, audio: inDetails.audio_tokens, image: inDetails.image_tokens }),
      out: pick({ text: outDetails.text_tokens, audio: outDetails.audio_tokens }),
    },
    // Each response reads the whole conversation, and its output joins it.
    contextTokens: tokensIn + tokensOut,
  };
}

function pick<K extends string>(values: Record<K, unknown>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const [key, value] of Object.entries(values) as Array<[K, unknown]>) {
    if (value != null) out[key] = Number(value);
  }
  return out;
}

function outputText(response: Wire): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text);
      else if (typeof content.transcript === "string") parts.push(content.transcript);
    }
  }
  return parts.join("\n").trim();
}
