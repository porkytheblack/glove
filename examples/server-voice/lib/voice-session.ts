// ─────────────────────────────────────────────────────────────────────────────
// One voice session. Everything in this file used to run in a browser tab.
//
// A session owns the whole loop for a single connected caller: the STT socket,
// the commitment engine, the front agent, the TTS socket, barge-in, and the
// delegation watch. The client contributes microphone samples and a speaker
// pair; it makes no decisions.
//
// The ordering that matters, and why:
//   • The STT gate closes while the agent speaks, so the agent's own voice
//     coming back through the room's microphone never lands in the transcript.
//     The VAD keeps listening throughout — that is what detects barge-in.
//   • The gate reopens when the CLIENT reports playback drained, not when the
//     gateway finishes sending. The gateway sends audio faster than realtime,
//     so "I sent the last byte" happens well before "the room went quiet".
//   • TTS sockets are opened on the VAD's first hint of speech, so the ~200ms
//     handshake overlaps transcription and model time instead of following it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ElevenLabsSTTAdapter,
  ElevenLabsTTSAdapter,
  type TurnContextMessage,
} from "glove-voice";
import { createElevenLabsSTTToken, createElevenLabsTTSToken } from "glove-voice/server";
import { MemoryStore, type SubscriberAdapter } from "glove-core";
import { buildFrontAgent } from "./front-agent";
import { SpeechTagParser } from "./speech-parser";
import {
  frameInterruption,
  frameSpeechFailure,
  frameTranscriptCorrection,
  frameWorkerResult,
  frameWorkerTrouble,
} from "./events";
import { SPEAKERS, ASSISTANT_NAME } from "./speakers";
import { LocalTurnDetector } from "./turn-detector-local";
import { TurnEngine } from "./turn-engine";
import { PROVIDER, frontProviderSort, modelFor } from "./models";
import type { ServerMessage, SpeakerRole } from "./protocol";

/** Rough speaking rate used to estimate how much of a cut line was heard. */
const TTS_CHARS_PER_SEC = 15;
/** Wait this long after playback drains before trusting the room to be quiet. */
const POST_SPEECH_DEADBAND_MS = 300;
/** Start synthesizing this early instead of buffering a full sentence. */
const CHUNK_LENGTH_SCHEDULE = [60, 120, 160, 250];
/** How often to check a delegated job for completion. */
const DELEGATION_POLL_MS = 250;

/** Spoken phrasing that promises a lookup is already underway. */
const PROMISE_RE =
  /\b(one (moment|sec(ond)?)|moment please|let me (check|see|look|pull|find|get)|i(?:'|’)?ll (check|look|pull|get|find)|checking (on )?that|looking (that|it|into) up|pulling (that|it) up|right away|hold on|give me a (sec|second|moment)|bear with me)\b/i;

/**
 * The backstop for a promise that never dispatched. Front models ack without
 * actually calling the tool often enough to matter — Kimi K2 does it
 * intermittently, sometimes by emitting the call as literal `<function_calls>`
 * markup instead of a real tool call, which never reaches the framework. The
 * room has already heard "checking on that", so silence here means the customer
 * waits forever. One corrective turn recovers it for the cost of a single fast
 * model round, and only on the failure path.
 */
const DELEGATION_NUDGE_PROMPT =
  "You just spoke a promise to look something up, but you did NOT call the delegate_to_worker tool — nothing was dispatched and the customer will wait forever. Call delegate_to_worker NOW as a real tool call (not text, and never as <function_calls> markup), with `request` restating what to look up including any hull id, customer name or model you heard. Output NOTHING else — no <speech> tags, the room already heard your acknowledgement. You do NOT have the answer yet and must not invent one.";

/**
 * Some models emit a tool call as literal markup in their text stream instead
 * of through the provider's tool-call channel — Kimi K2 does this
 * intermittently:
 *
 *     <function_calls><invoke name="delegate_to_worker">
 *       <parameter name="request">Check warranty for KES-0007</parameter>
 *
 * The framework never sees a tool call, so nothing dispatches. The `<speech>`
 * protocol keeps the markup out of the audio, but the request is still sitting
 * right there in the raw output — so recover it deterministically rather than
 * spending a model round hoping the retry comes back well-formed.
 */
const TEXTUAL_TOOL_CALL_RE =
  /<invoke\s+name=["']delegate_to_worker["']>[\s\S]*?<parameter\s+name=["']request["']>([\s\S]*?)(?:<\/parameter>|<\/invoke>|$)/i;

export interface VoiceSessionDeps {
  /** Queue a research job; resolves with the run id once queued. */
  delegate(request: string, sessionId: string): Promise<string>;
  /** Resolve a queued job — completes when the worker finishes or fails. */
  awaitDelegation(jobId: string): Promise<{ answer: string } | { error: string }>;
  /** Send a JSON control frame to the client. */
  send(msg: ServerMessage): void;
  /** Send raw PCM16 to the client. */
  sendAudio(pcm: Uint8Array): void;
  /** Append a metric record to the session log. */
  metric(name: string, ms?: number, data?: Record<string, unknown>): void;
  elevenLabsApiKey: string;
  voiceId: string;
  ttsModel: string;
}

export class VoiceSession {
  readonly id: string;
  private readonly deps: VoiceSessionDeps;

  private stt!: ElevenLabsSTTAdapter;
  private engine!: TurnEngine;
  private front!: ReturnType<typeof buildFrontAgent>;

  private speaker: SpeakerRole = "operator";
  private closed = false;

  // ── speaking state ─────────────────────────────────────────────────────────
  private tts: ElevenLabsTTSAdapter | null = null;
  private prewarmed: { tts: ElevenLabsTTSAdapter; at: number } | null = null;
  private turnSeq = 0;
  private activeTurn: {
    id: number;
    sentText: string;
    firstAudioAt: number;
    sawAudio: boolean;
  } | null = null;
  private speaking = false;
  private gateReopenTimer: NodeJS.Timeout | null = null;

  // ── agent turn state ───────────────────────────────────────────────────────
  private parser: SpeechTagParser | null = null;
  private turnQueue: Promise<void> = Promise.resolve();
  private turnStartAt = 0;
  private ttftPending = false;
  private history: TurnContextMessage[] = [];
  private pendingInterruption: string | null = null;
  /** Did the model actually call delegate_to_worker during the current turn? */
  private delegatedThisTurn = false;
  /** A corrective turn: its job is to dispatch, never to talk. Anything it
   *  generates is parsed (so a textual tool call can still be salvaged) but
   *  never reaches TTS — a nudged model that ignores "say nothing" and invents
   *  an answer must not be able to read it to the room. */
  private silentTurn = false;

  constructor(id: string, deps: VoiceSessionDeps) {
    this.id = id;
    this.deps = deps;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.front = buildFrontAgent(new MemoryStore(`front_${this.id}`), {
      delegate: (request) => this.startDelegation(request),
    });
    this.front.addSubscriber(this.makeSubscriber());

    this.stt = new ElevenLabsSTTAdapter({
      // Server-side, the "token" step is a local function call against the API
      // key this process already holds — no route, no round trip to a browser.
      getToken: () => createElevenLabsSTTToken(this.deps.elevenLabsApiKey),
    });
    this.stt.on("error", (e) => this.deps.send({ t: "error", message: e.message }));

    this.engine = new TurnEngine({
      stt: this.stt,
      detector: new LocalTurnDetector(),
      hooks: {
        onUtterance: (text) => this.onUtterance(text),
        onPartial: (text) => this.deps.send({ t: "partial", text }),
        onTranscriptCorrection: (sent, actual) => this.onTranscriptCorrection(sent, actual),
        onBargeIn: () => this.bargeIn(),
        onSpeechLikely: () => this.prewarm(),
        isAgentSpeaking: () => this.speaking,
        getTurnContext: () => this.history.slice(-4),
        onMetric: (name, ms, data) => this.deps.metric(name, ms, data),
      },
    });

    await this.stt.connect();

    this.deps.metric("session_config", undefined, {
      provider: PROVIDER,
      frontModel: modelFor("front") ?? "(provider default)",
      workerModel: modelFor("worker") ?? "(provider default)",
      frontProviderSort: frontProviderSort() ?? "off",
      ttsModel: this.deps.ttsModel,
      transport: "websocket-pcm16",
    });

    this.deps.send({
      t: "ready",
      sessionId: this.id,
      config: {
        provider: PROVIDER,
        front: modelFor("front") ?? "(default)",
        worker: modelFor("worker") ?? "(default)",
        tts: this.deps.ttsModel,
        turnDetector: "livekit-eou (in-process)",
      },
      speakers: SPEAKERS.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
      })),
      assistantName: ASSISTANT_NAME,
    });
    this.pushState();
  }

  close(): void {
    this.closed = true;
    if (this.gateReopenTimer) clearTimeout(this.gateReopenTimer);
    this.engine?.dispose();
    this.stt?.disconnect();
    this.tts?.destroy();
    this.prewarmed?.tts.destroy();
  }

  // ── client input ───────────────────────────────────────────────────────────

  handleAudio(pcm: Int16Array): void {
    if (this.closed) return;
    this.engine.processAudio(pcm);
  }

  setSpeaker(speaker: SpeakerRole): void {
    this.speaker = speaker;
  }

  /** Typed input takes the same path as a spoken utterance. */
  handleTyped(speaker: SpeakerRole, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.speaker = speaker;
    this.onUtterance(trimmed);
  }

  /** The browser finished draining its playback buffer. */
  handlePlaybackDone(turnId: number): void {
    if (this.activeTurn && this.activeTurn.id !== turnId) return;
    this.endSpeaking();
  }

  // ── utterances → agent turns ───────────────────────────────────────────────

  private onUtterance(text: string): void {
    const speaker = SPEAKERS.find((s) => s.id === this.speaker);
    const label = speaker?.shortName ?? this.speaker;
    this.deps.send({ t: "utterance", speaker: this.speaker, text });
    this.history.push({ role: "user", content: text });
    this.enqueueTurn(`[${label} (${this.speaker})] ${text}`);
  }

  private onTranscriptCorrection(sent: string, actual: string): void {
    this.deps.send({ t: "utterance", speaker: this.speaker, text: `(corrected) ${actual}` });
    this.enqueueTurn(frameTranscriptCorrection(sent, actual));
  }

  /** Agent turns are serialized — two overlapping turns would interleave their
   *  speech into one TTS socket. */
  private enqueueTurn(prompt: string): void {
    this.turnQueue = this.turnQueue
      .then(() => this.runFrontTurn(prompt))
      .catch((err) => {
        this.deps.send({ t: "error", message: (err as Error)?.message ?? "turn failed" });
      });
  }

  private async runFrontTurn(prompt: string, opts?: { isNudge?: boolean }): Promise<void> {
    if (this.closed) return;
    const isNudge = opts?.isNudge ?? false;
    this.delegatedThisTurn = false;
    this.silentTurn = isNudge;

    // A barge-in that landed while the previous turn was still generating is
    // reported at the head of the NEXT turn, so the model learns what the room
    // actually heard before it decides what to say.
    let framed = prompt;
    if (this.pendingInterruption) {
      framed = `${this.pendingInterruption}\n\n${prompt}`;
      this.pendingInterruption = null;
    }

    this.turnStartAt = Date.now();
    this.ttftPending = true;
    const turnId = ++this.turnSeq;
    this.setThinking(true);

    const parser = new SpeechTagParser((text) => this.onSpeechText(turnId, text));
    this.parser = parser;
    try {
      await this.front.processRequest(framed);
    } finally {
      this.parser = null;
      this.silentTurn = false;
      this.setThinking(false);
    }

    const spoken = parser.finish();
    if (spoken) this.history.push({ role: "assistant", content: spoken });

    // Recovery, cheapest first. A promise the room heard must end in a real
    // dispatch, or the customer waits forever.
    if (!this.delegatedThisTurn) {
      // 1. The call is already in the raw output as markup — just run it.
      const textual = TEXTUAL_TOOL_CALL_RE.exec(parser.raw);
      if (textual?.[1]?.trim()) {
        const request = textual[1].trim();
        this.deps.metric("delegation_salvaged", undefined, { chars: request.length });
        try {
          await this.startDelegation(request);
        } catch {
          /* fall through to the nudge */
        }
      }
      // 2. Otherwise, if she SAID she was on it, force the call in a silent
      //    corrective turn.
      if (!this.delegatedThisTurn && !isNudge && PROMISE_RE.test(spoken)) {
        this.deps.metric("delegation_nudge", undefined, { spoken: spoken.slice(0, 120) });
        try {
          await this.runFrontTurn(DELEGATION_NUDGE_PROMPT, { isNudge: true });
          if (this.delegatedThisTurn) this.deps.metric("delegation_recovered");
        } catch {
          /* best-effort — a failed nudge just leaves the original silence */
        }
      }
    }
    this.deps.metric("front_transcript", undefined, {
      input: framed.slice(0, 1500),
      raw: parser.raw.slice(0, 6000),
      spoken: spoken.slice(0, 3000),
    });

    if (this.activeTurn?.id === turnId) {
      // Close the stream so ElevenLabs synthesizes the tail immediately.
      this.tts?.flush();
      this.deps.send({ t: "speech_end", turnId });
    } else if (spoken && !this.activeTurn) {
      // Text was produced but no socket carried it.
      this.enqueueTurn(frameSpeechFailure("no audio channel was open"));
    }
  }

  // ── speaking ───────────────────────────────────────────────────────────────

  /** Open a TTS socket ahead of need, so its handshake overlaps model time. */
  private prewarm(): void {
    if (this.closed || this.tts || this.prewarmed) return;
    const tts = this.makeTts();
    this.prewarmed = { tts, at: Date.now() };
    void tts.open().catch(() => {
      if (this.prewarmed?.tts === tts) this.prewarmed = null;
    });
  }

  private makeTts(): ElevenLabsTTSAdapter {
    return new ElevenLabsTTSAdapter({
      getToken: () => createElevenLabsTTSToken(this.deps.elevenLabsApiKey),
      voiceId: this.deps.voiceId,
      model: this.deps.ttsModel,
      outputFormat: "pcm_16000",
      generationConfig: { chunkLengthSchedule: CHUNK_LENGTH_SCHEDULE },
    });
  }

  /** A span of in-tag text from the agent: speak it and mirror it to the UI. */
  private onSpeechText(turnId: number, text: string): void {
    if (this.closed) return;
    if (this.silentTurn) return; // corrective turn — parsed, but never spoken
    if (this.ttftPending) {
      this.ttftPending = false;
      this.deps.metric("front_ttft_ms", Date.now() - this.turnStartAt);
    }
    this.deps.send({ t: "speech", turnId, text });

    if (!this.activeTurn || this.activeTurn.id !== turnId) {
      this.beginTurnAudio(turnId);
    }
    this.activeTurn!.sentText += text;
    this.tts?.sendText(text, { flush: false });
  }

  private beginTurnAudio(turnId: number): void {
    // Adopt the prewarmed socket if one is waiting, else open cold.
    const tts = this.prewarmed?.tts ?? this.makeTts();
    const wasPrewarmed = Boolean(this.prewarmed);
    this.prewarmed = null;
    this.tts = tts;
    this.activeTurn = { id: turnId, sentText: "", firstAudioAt: 0, sawAudio: false };

    tts.on("audio_chunk", (chunk: Uint8Array) => {
      if (this.closed || this.activeTurn?.id !== turnId) return; // voided by barge-in
      if (!this.activeTurn.sawAudio) {
        this.activeTurn.sawAudio = true;
        this.activeTurn.firstAudioAt = Date.now();
        this.deps.metric("tts_first_audio_ms", Date.now() - this.turnStartAt, {
          prewarmed: wasPrewarmed,
        });
        this.beginSpeaking();
      }
      this.deps.sendAudio(chunk);
    });
    tts.on("error", (e: Error) => {
      if (this.activeTurn?.id !== turnId) return;
      this.deps.send({ t: "error", message: `TTS: ${e.message}` });
      this.teardownTurnAudio();
      this.enqueueTurn(frameSpeechFailure(e.message));
    });

    if (!wasPrewarmed) {
      void tts.open().catch((e: Error) => {
        this.deps.send({ t: "error", message: `TTS: ${e.message}` });
      });
    }
  }

  private beginSpeaking(): void {
    if (this.speaking) return;
    this.speaking = true;
    // Stop feeding the microphone to STT — but the VAD keeps listening, which
    // is what makes barge-in possible.
    this.engine.setGateOpen(false);
    if (this.gateReopenTimer) {
      clearTimeout(this.gateReopenTimer);
      this.gateReopenTimer = null;
    }
    this.pushState();
  }

  /** Playback drained (or was cut): reopen the microphone path after a short
   *  deadband so the tail of the agent's own audio doesn't trip the VAD. */
  private endSpeaking(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.teardownTurnAudio();
    if (this.gateReopenTimer) clearTimeout(this.gateReopenTimer);
    this.gateReopenTimer = setTimeout(() => {
      this.gateReopenTimer = null;
      if (!this.closed) this.engine.setGateOpen(true);
    }, POST_SPEECH_DEADBAND_MS);
    this.pushState();
  }

  private teardownTurnAudio(): void {
    this.tts?.destroy();
    this.tts = null;
    this.activeTurn = null;
  }

  /**
   * Someone talked over the agent. Estimate how much of the line actually
   * reached the room BEFORE tearing the audio down, so the model can be told
   * where it was cut — then stop everything, locally and in the browser.
   */
  private bargeIn(): void {
    if (!this.speaking) return;
    const active = this.activeTurn;
    const playedMs = active?.firstAudioAt ? Date.now() - active.firstAudioAt : 0;
    const heard = active ? estimateHeard(active.sentText, playedMs) : "";

    this.teardownTurnAudio();
    this.speaking = false;
    // Drop whatever is still buffered in the browser. Without this the room
    // keeps hearing the sentence the speaker just interrupted.
    this.deps.send({ t: "clear" });
    this.engine.setGateOpen(true);
    this.deps.metric("barge_in", playedMs, { heardChars: heard.length });
    // Queued rather than sent as its own turn: the interruption is context for
    // whatever they are about to say, not a prompt to answer on its own.
    this.pendingInterruption = frameInterruption(heard);
    this.pushState();
  }

  // ── delegation ─────────────────────────────────────────────────────────────

  /**
   * Queue a research job and start watching for its result. Returns as soon as
   * the job is queued so the agent's turn can finish and it can acknowledge
   * out loud — the answer arrives later, as its own turn (§5).
   */
  private async startDelegation(request: string): Promise<string> {
    this.delegatedThisTurn = true;
    const queuedAt = Date.now();
    const jobId = await this.deps.delegate(request, this.id);
    this.deps.send({ t: "delegation", jobId, phase: "queued", detail: request.slice(0, 160) });
    this.deps.metric("delegation_queued", undefined, { jobId, chars: request.length });

    void this.deps
      .awaitDelegation(jobId)
      .then((result) => {
        if (this.closed) return;
        const ms = Date.now() - queuedAt;
        if ("answer" in result) {
          this.deps.send({ t: "delegation", jobId, phase: "done" });
          this.deps.metric("delegation_roundtrip_ms", ms, { jobId });
          this.enqueueTurn(frameWorkerResult(result.answer));
        } else {
          this.deps.send({ t: "delegation", jobId, phase: "failed", detail: result.error });
          this.deps.metric("delegation_failed", ms, { jobId, error: result.error });
          this.enqueueTurn(frameWorkerTrouble(result.error));
        }
      })
      .catch((err) => {
        if (this.closed) return;
        this.enqueueTurn(frameWorkerTrouble((err as Error)?.message ?? "unknown failure"));
      });

    return jobId;
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  private makeSubscriber(): SubscriberAdapter {
    return {
      record: async (type, data) => {
        if (type === "text_delta") {
          this.parser?.push((data as { text: string }).text);
        } else if (type === "token_consumption") {
          const c = (data as { consumption: { tokens_in: number; tokens_out: number } })
            .consumption;
          this.deps.metric("front_tokens", undefined, {
            in: c.tokens_in ?? 0,
            out: c.tokens_out ?? 0,
          });
        }
      },
    };
  }

  private thinking = false;
  private setThinking(v: boolean): void {
    this.thinking = v;
    this.pushState();
  }

  private pushState(): void {
    if (this.closed) return;
    this.deps.send({
      t: "state",
      listening: !this.speaking,
      speaking: this.speaking,
      thinking: this.thinking,
    });
  }
}

/** How much of `sentText` had plausibly been spoken after `playedMs`. */
function estimateHeard(sentText: string, playedMs: number): string {
  if (!sentText || playedMs <= 0) return "";
  const n = Math.min(sentText.length, Math.round((playedMs / 1000) * TTS_CHARS_PER_SEC));
  if (n <= 0) return "";
  const cut = sentText.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}

export { DELEGATION_POLL_MS };
