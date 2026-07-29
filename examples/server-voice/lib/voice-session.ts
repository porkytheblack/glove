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
import { mountMesh, type IncomingMeshMessage } from "glove-mesh";
import { FRONT_IDENTITY, RoomMeshAdapter, WORKER_ID } from "./mesh-transport";
import { buildFrontAgent } from "./front-agent";
import { SpeechTagParser, salvageWrappedSpeech } from "./speech-parser";
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
import { SileroVADNode } from "./silero-vad-node";
import { PROVIDER, frontProviderSort, modelFor } from "./models";
import type { ServerMessage, SpeakerRole } from "./protocol";

/** Rough speaking rate used to estimate how much of a cut line was heard. */
const TTS_CHARS_PER_SEC = 15;
/** Wait this long after playback drains before trusting the room to be quiet. */
const POST_SPEECH_DEADBAND_MS = 300;
/** Grace on top of the audio's own duration before assuming playback finished.
 *  Covers the client's jitter buffer and the trip back; `playback_done` almost
 *  always wins the race, and this only decides how long a room stays deaf when
 *  it does not. */
const PLAYBACK_WATCHDOG_SLACK_MS = 1500;
/** At most one "your line never played" turn per window — see reportSpeechFailure. */
const SPEECH_FAILURE_COOLDOWN_MS = 30_000;
/** Nudge an idle prewarmed TTS socket this often — ElevenLabs drops an input
 *  stream that goes quiet for ~20s. */
const PREWARM_KEEPALIVE_MS = 8_000;
/** …but stop holding one open speculatively after this long. */
const PREWARM_MAX_AGE_MS = 60_000;
/** Start synthesizing this early instead of buffering a full sentence. */
const CHUNK_LENGTH_SCHEDULE = [60, 120, 160, 250];
/** Opens the turn after one that wrote text but spoke none of it. Bare prose
 *  meant for the room is formally identical to a legitimate silent note, so
 *  instead of guessing, the model is told the room heard nothing and repairs
 *  itself if repair was needed. */
const PROTOCOL_NOTE =
  '<speech-protocol-note>Your previous turn produced text but NO <speech> tags, so the room heard none of it. If you meant to stay silent, that was correct — ignore this. If you meant to be heard, that line is gone: say what matters now, inside <speech>...</speech>.</speech-protocol-note>';

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
  'You just spoke a promise to look something up, but you did NOT call glove_mesh_send_message — nothing was dispatched and the customer will wait forever. Call glove_mesh_send_message NOW as a real tool call (not text, and never as <function_calls> markup), with to: "worker", blocking: true, and content restating the request including any hull id, customer name or model you heard. Output NOTHING else — no <speech> tags, the room already heard your acknowledgement. You do NOT have the answer yet and must not invent one.';

/**
 * Recover a delegation the model MEANT to make but emitted as text.
 *
 * Providers do not always parse a model's tool-call syntax back out of the
 * token stream, and when they don't, the call arrives as plain text and the
 * framework never sees it. Observed twice with Kimi K2, in two different
 * shapes:
 *
 *   Anthropic-style XML
 *     <invoke name="glove_mesh_send_message">
 *       <parameter name="content">Check warranty for KES-0007</parameter>
 *
 *   its own native control tokens, leaked verbatim
 *     glove_mesh_send_message:0<|tool_call_argument_begin|>
 *     {"to": "worker", "blocking": true, "content": "…"}<|tool_call_end|>
 *
 * Both carry the request in full, so recover it deterministically instead of
 * spending a model round hoping the retry comes back well-formed. The
 * `<speech>` protocol already keeps this markup out of the audio; this keeps
 * the WORK from being lost with it.
 */
const XML_TOOL_CALL_RE =
  /<invoke\s+name=["']glove_mesh_send_message["']>[\s\S]*?<parameter\s+name=["']content["']>([\s\S]*?)(?:<\/parameter>|<\/invoke>|$)/i;

export function extractTextualDelegation(raw: string): string | null {
  const xml = XML_TOOL_CALL_RE.exec(raw);
  if (xml?.[1]?.trim()) return xml[1].trim();

  // Native-token form: find the tool name, then the first balanced JSON object
  // after it, and read `content` out of it.
  const at = raw.indexOf("glove_mesh_send_message");
  if (at < 0) return null;
  const open = raw.indexOf("{", at);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(raw.slice(open, i + 1)) as { content?: unknown };
          const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
          return content || null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface VoiceSessionDeps {
  /** Queue a research job and return once QUEUED. The answer comes back over
   *  the mesh, not from this promise — that is what keeps Nova responsive. */
  dispatchResearch(input: { request: string; messageId: string }): Promise<string>;
  /** Send a JSON control frame to the client. */
  send(msg: ServerMessage): void;
  /** Send raw PCM16 to the client. */
  sendAudio(pcm: Uint8Array): void;
  /** Append a metric record to the session log. */
  metric(name: string, ms?: number, data?: Record<string, unknown>): void;
  elevenLabsApiKey: string;
  voiceId: string;
  ttsModel: string;
  /** How patient the room is about deciding you have finished speaking. */
  endpointing?: {
    vadSilenceMs?: number;
    vadThreshold?: number;
    minHoldMs?: number;
    maxHoldMs?: number;
    /** "energy" forces the zero-dependency VAD; anything else uses Silero. */
    vad?: string;
  };
}

export class VoiceSession {
  readonly id: string;
  private readonly deps: VoiceSessionDeps;

  private stt!: ElevenLabsSTTAdapter;
  private engine!: TurnEngine;
  private front!: ReturnType<typeof buildFrontAgent>;
  private mesh!: RoomMeshAdapter;
  /** mesh message id → when it was dispatched, for round-trip timing. */
  private readonly pendingDelegations = new Map<string, number>();
  private vadKind: "silero" | "energy" = "energy";
  /** Is a caller currently attached? The room outlives any single client. */
  private attached = false;

  private speaker: SpeakerRole = "operator";
  private closed = false;

  // ── speaking state ─────────────────────────────────────────────────────────
  private tts: ElevenLabsTTSAdapter | null = null;
  /** Resolves when the current turn's TTS socket has finished its handshake.
   *  The end-of-turn flush must wait on this — see runFrontTurn. */
  private ttsOpen: Promise<void> = Promise.resolve();
  private prewarmed: {
    tts: ElevenLabsTTSAdapter;
    at: number;
    keepalive: NodeJS.Timeout | null;
    open: boolean;
  } | null = null;
  private turnSeq = 0;
  private activeTurn: {
    id: number;
    sentText: string;
    firstAudioAt: number;
    sawAudio: boolean;
    /** Bytes of PCM sent, so playback length can be derived without the client. */
    audioBytes: number;
  } | null = null;
  private speaking = false;
  private gateReopenTimer: NodeJS.Timeout | null = null;
  private playbackWatchdog: NodeJS.Timeout | null = null;

  // ── agent turn state ───────────────────────────────────────────────────────
  private parser: SpeechTagParser | null = null;
  private turnQueue: Promise<void> = Promise.resolve();
  private turnStartAt = 0;
  private ttftPending = false;
  private history: TurnContextMessage[] = [];
  private pendingInterruption: string | null = null;
  /** Set when a turn wrote text but spoke nothing — the next turn opens with
   *  a protocol reminder so the model can repair itself. */
  private pendingProtocolNote = false;
  /** Did the model actually dispatch over the mesh during the current turn? */
  private delegatedThisTurn = false;
  /**
   * Turns killed by a barge-in. The model keeps streaming text for a turn long
   * after its audio is cut, and without this the next chunk finds no active
   * turn, opens a FRESH TTS socket and she carries on talking — which is
   * exactly what "cannot interrupt" looks like from the room.
   */
  private readonly voidedTurns = new Set<number>();
  /** A corrective turn: its job is to dispatch, never to talk. Anything it
   *  generates is parsed (so a textual tool call can still be salvaged) but
   *  never reaches TTS — a nudged model that ignores "say nothing" and invents
   *  an answer must not be able to read it to the room. */
  private silentTurn = false;
  /** When the last speech-failure turn was raised. Reporting a failed line is
   *  itself a spoken turn, so an unhealthy TTS path can trigger a failure turn
   *  whose own audio fails, forever. This throttles that into one report. */
  private lastSpeechFailureAt = 0;

  constructor(id: string, deps: VoiceSessionDeps) {
    this.id = id;
    this.deps = deps;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.front = buildFrontAgent(new MemoryStore(`front_${this.id}`));
    this.front.addSubscriber(this.makeSubscriber());

    // Nova talks to the worker over the mesh exactly as she does in the
    // browser-hosted example. The adapter is what changes: a send becomes a
    // queued signal run, and the threaded reply arrives over HTTP.
    this.mesh = new RoomMeshAdapter({
      dispatch: async ({ request, messageId }) => {
        const jobId = await this.deps.dispatchResearch({ request, messageId });
        this.deps.send({
          t: "delegation",
          jobId,
          phase: "queued",
          detail: request.slice(0, 160),
        });
        this.deps.metric("delegation_queued", undefined, { jobId, messageId });
        this.pendingDelegations.set(messageId, Date.now());
        return jobId;
      },
    });
    await mountMesh(this.front, { adapter: this.mesh, identity: FRONT_IDENTITY });

    this.stt = new ElevenLabsSTTAdapter({
      // Server-side, the "token" step is a local function call against the API
      // key this process already holds — no route, no round trip to a browser.
      getToken: () => createElevenLabsSTTToken(this.deps.elevenLabsApiKey),
    });
    this.stt.on("error", (e) => this.deps.send({ t: "error", message: e.message }));

    this.engine = new TurnEngine({
      stt: this.stt,
      vadSilenceMs: this.deps.endpointing?.vadSilenceMs,
      vadThreshold: this.deps.endpointing?.vadThreshold,
      detector: new LocalTurnDetector({
        minHoldMs: this.deps.endpointing?.minHoldMs,
        maxHoldMs: this.deps.endpointing?.maxHoldMs,
      }),
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

    // Swap the energy VAD for the neural one. This is what decides when you
    // have started and stopped talking, and the energy VAD — thresholding
    // loudness against a drifting noise floor — misses soft or distant speech
    // outright. Silero knows what speech sounds like: it catches a quiet
    // "mm-hmm" and ignores a slammed door, and it can distinguish tentative
    // from confirmed speech, which is what makes barge-in trustworthy.
    //
    // Failure is non-fatal by design: a room with the energy VAD is worse, but
    // a room that refuses to start is useless.
    if (this.deps.endpointing?.vad !== "energy") {
      try {
        const t0 = Date.now();
        const silero = new SileroVADNode({
          redemptionMs: this.deps.endpointing?.vadSilenceMs,
        });
        await silero.init();
        this.engine.useSilero(silero);
        this.vadKind = "silero";
        this.deps.metric("vad_ready", Date.now() - t0, { kind: "silero" });
      } catch (err) {
        this.deps.metric("vad_fallback", undefined, { reason: (err as Error)?.message });
        console.log(
          `Silero VAD unavailable (${(err as Error)?.message}) — using the energy VAD`,
        );
      }
    }

    await this.stt.connect();

    this.deps.metric("session_config", undefined, {
      provider: PROVIDER,
      frontModel: modelFor("front") ?? "(provider default)",
      workerModel: modelFor("worker") ?? "(provider default)",
      frontProviderSort: frontProviderSort() ?? "off",
      ttsModel: this.deps.ttsModel,
      transport: "websocket-pcm16",
    });

    this.sendReady();
    this.pushState();
  }

  private sendReady(): void {
    this.deps.send({
      t: "ready",
      sessionId: this.id,
      config: {
        provider: PROVIDER,
        front: modelFor("front") ?? "(default)",
        worker: modelFor("worker") ?? "(default)",
        tts: this.deps.ttsModel,
        turnDetector: "livekit-eou (in-process)",
        vad: this.vadKind,
        endpointing: `vad ${this.deps.endpointing?.vadSilenceMs ?? 450}ms / hold ${
          this.deps.endpointing?.minHoldMs ?? 400
        }-${this.deps.endpointing?.maxHoldMs ?? 2800}ms`,
      },
      speakers: SPEAKERS.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
      })),
      assistantName: ASSISTANT_NAME,
    });
  }

  close(): void {
    this.closed = true;
    if (this.gateReopenTimer) clearTimeout(this.gateReopenTimer);
    this.engine?.dispose();
    this.stt?.disconnect();
    this.teardownTurnAudio(); // detach-then-destroy — see the comment there
    if (this.prewarmed?.keepalive) clearInterval(this.prewarmed.keepalive);
    const warm = this.prewarmed;
    this.prewarmed = null;
    warm?.tts.destroy();
  }

  // ── caller attach / detach ─────────────────────────────────────────────────
  //
  // The room is durable: it is the beacon, not the socket. A caller dropping
  // (page reload, flaky network, tab close) must not tear down the front
  // agent's history or a delegation already in flight — they reconnect and the
  // conversation continues where it was.

  /** A caller connected. Re-announce the room so a reconnecting client can
   *  render its state immediately. */
  attach(): void {
    this.attached = true;
    this.sendReady();
    this.pushState();
  }

  /** The caller went away. Stop speaking into a socket nobody is holding, but
   *  keep the agent, its history, and any in-flight delegation alive. */
  detach(): void {
    this.attached = false;
    // Same reasoning as barge-in: the model may still be streaming deltas for
    // this turn, and without voiding it the next chunk opens a fresh TTS socket
    // and the reconnecting caller is greeted mid-sentence by the last one's answer.
    if (this.activeTurn) this.voidedTurns.add(this.activeTurn.id);
    this.teardownTurnAudio();
    this.speaking = false;
    this.engine.setGateOpen(true);
    // Half-heard words do not survive the caller who spoke them.
    this.engine.resetTranscript();
  }

  // ── client input ───────────────────────────────────────────────────────────

  handleAudio(pcm: Int16Array): void {
    if (this.closed || !this.attached) return;
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
    if (this.pendingProtocolNote) {
      this.pendingProtocolNote = false;
      framed = `${PROTOCOL_NOTE}\n\n${framed}`;
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

    let spoken = parser.finish();

    // The model spoke, but in the wrong envelope — dialogue wrapped in a tag
    // named after the person it was answering instead of <speech>. Without
    // this, the turn is silent, and because the agent's history now contains
    // its own malformed turn, every turn after it tends to repeat the format:
    // the room permanently stops answering. Streaming is lost (the text is
    // only known complete), but a late line beats no line.
    if (!spoken && !isNudge && !this.voidedTurns.has(turnId)) {
      const salvaged = salvageWrappedSpeech(parser.raw, VoiceSession.SALVAGE_TAGS);
      if (salvaged) {
        this.deps.metric("speech_salvaged", undefined, { chars: salvaged.length });
        this.onSpeechText(turnId, salvaged);
        spoken = salvaged;
      }
    }

    if (spoken) this.history.push({ role: "assistant", content: spoken });

    // A turn that WROTE text but SPOKE none of it is usually the model
    // drifting off the protocol — bare prose with no tags, observed live as
    // "I already gave you the rundown on the Kestrel L2 just now—..." which
    // the caller never heard. That specific shape cannot be salvaged safely
    // (in form it is identical to a legitimate silent note), so make the
    // failure visible to the model instead: next turn opens with a reminder,
    // and it re-says what mattered properly. Worded so that intended silence
    // costs nothing.
    if (!spoken && !isNudge && !this.delegatedThisTurn && parser.raw.trim()) {
      this.deps.metric("speech_protocol_drift", undefined, { raw: parser.raw.slice(0, 300) });
      this.pendingProtocolNote = true;
    }

    // Recovery, cheapest first. A promise the room heard must end in a real
    // dispatch, or the customer waits forever.
    if (!this.delegatedThisTurn) {
      // 1. The call is already in the raw output as markup — just run it.
      const request = extractTextualDelegation(parser.raw);
      if (request) {
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

    if (this.voidedTurns.has(turnId)) {
      // Interrupted: no flush, no speech_end. The interruption notice already
      // tells the model how much of the line was actually heard.
      this.voidedTurns.delete(turnId);
      return;
    }

    if (this.activeTurn?.id === turnId) {
      // Wait for the socket's handshake before closing the stream.
      //
      // `flush()` only sends the EOS marker if the socket is already OPEN, and
      // a short reply can finish generating before the ~400ms handshake does.
      // Drop the EOS and the queued text just sits there: it is under the
      // first chunk_length_schedule threshold (60 chars), so ElevenLabs keeps
      // buffering and never synthesizes — the turn is silent, with no error.
      // Long replies hid this by outlasting the handshake.
      await this.ttsOpen.catch(() => {});
      if (this.closed || this.activeTurn?.id !== turnId) return;
      // Close the stream so ElevenLabs synthesizes the tail immediately.
      this.tts?.flush();
      this.deps.send({ t: "speech_end", turnId });
    } else if (spoken && !this.activeTurn && !isNudge) {
      // Text was produced but no socket carried it.
      this.reportSpeechFailure("no audio channel was open");
    }
  }

  // ── speaking ───────────────────────────────────────────────────────────────

  /**
   * Open a TTS socket ahead of need, so its handshake overlaps model time.
   *
   * A prewarmed socket has to be kept ALIVE and dropped when it dies, or the
   * optimisation turns into total silence: ElevenLabs closes an input stream
   * that receives nothing for ~20s (`input_timeout_exceeded`), and a dead
   * socket left sitting in `prewarmed` gets adopted by the next turn, which
   * then streams its text into a closed connection. No audio, every turn,
   * with only the first failure visible because speech-failure reporting is
   * throttled.
   */
  private prewarm(): void {
    if (this.closed || this.tts || this.prewarmed) return;
    const tts = this.makeTts();
    const entry = { tts, at: Date.now(), keepalive: null as NodeJS.Timeout | null, open: false };
    this.prewarmed = entry;

    const drop = () => {
      if (entry.keepalive) clearInterval(entry.keepalive);
      entry.keepalive = null;
      if (this.prewarmed === entry) this.prewarmed = null;
    };
    // Whatever kills it — handshake failure, idle close, provider hiccup — it
    // must not still be sitting here when the next turn looks for a socket.
    tts.on("error", drop);

    void tts
      .open()
      .then(() => {
        entry.open = true;
        entry.keepalive = setInterval(() => {
          if (this.prewarmed !== entry) return;
          // Don't hold a socket open indefinitely on the chance it gets used.
          if (Date.now() - entry.at > PREWARM_MAX_AGE_MS) {
            tts.destroy();
            drop();
            return;
          }
          // A space is the cheapest thing that resets the input timeout without
          // synthesizing anything audible.
          tts.sendText(" ");
        }, PREWARM_KEEPALIVE_MS);
      })
      .catch(drop);
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

  /** Tag names that mean "the model was talking to the room": every roster
   *  participant (id and first name), the assistant itself, and the obvious
   *  generic envelopes. */
  private static readonly SALVAGE_TAGS: string[] = [
    ...SPEAKERS.flatMap((s) => [s.id, s.shortName.split(/[\s.]+/)[0]]),
    ASSISTANT_NAME,
    "reply",
    "response",
    "answer",
    "say",
  ];

  /** A span of in-tag text from the agent: speak it and mirror it to the UI. */
  private onSpeechText(turnId: number, text: string): void {
    if (this.closed) return;
    if (this.silentTurn) return; // corrective turn — parsed, but never spoken
    // Cut off mid-sentence: everything still arriving for this turn is text the
    // room will never hear, so it must not reach TTS or the transcript.
    if (this.voidedTurns.has(turnId)) return;
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
    // Adopt the prewarmed socket only if it actually opened and is still live —
    // adopting a closed one is indistinguishable from working, except nothing
    // is ever heard.
    const warm = this.prewarmed;
    const usable = warm?.open && warm.tts.isReady ? warm : null;
    if (warm && !usable) {
      warm.tts.destroy();
      this.deps.metric("tts_prewarm_discarded");
    }
    if (warm?.keepalive) clearInterval(warm.keepalive);
    this.prewarmed = null;

    const tts = usable?.tts ?? this.makeTts();
    const wasPrewarmed = Boolean(usable);
    this.tts = tts;
    this.activeTurn = { id: turnId, sentText: "", firstAudioAt: 0, sawAudio: false, audioBytes: 0 };

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
      this.activeTurn.audioBytes += chunk.byteLength;
      this.deps.sendAudio(chunk);
      this.armPlaybackWatchdog();
    });
    tts.on("error", (e: Error) => {
      if (this.activeTurn?.id !== turnId) return;
      this.deps.send({ t: "error", message: `TTS: ${e.message}` });
      this.teardownTurnAudio();
      this.reportSpeechFailure(e.message);
    });

    if (wasPrewarmed) {
      this.ttsOpen = Promise.resolve();
    } else {
      this.ttsOpen = tts.open().catch((e: Error) => {
        this.deps.send({ t: "error", message: `TTS: ${e.message}` });
      });
    }
  }

  /**
   * Tell the model its line never played — at most once per window.
   *
   * Without the throttle this recurses: the failure notice is itself a spoken
   * turn, so if the TTS path is unhealthy its audio fails too, raising another
   * notice, forever. Observed in testing as a burst of hundreds of identical
   * TTS errors in a single millisecond.
   */
  private reportSpeechFailure(detail: string): void {
    const now = Date.now();
    if (now - this.lastSpeechFailureAt < SPEECH_FAILURE_COOLDOWN_MS) {
      this.deps.metric("speech_failure_suppressed", undefined, { detail });
      return;
    }
    this.lastSpeechFailureAt = now;
    this.deps.metric("speech_failure", undefined, { detail });
    this.enqueueTurn(frameSpeechFailure(detail));
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

  /**
   * Reopen the microphone on our own schedule if the caller never says it
   * finished playing.
   *
   * The gate is closed while the agent speaks and reopened by `playback_done`,
   * which is a message from the BROWSER — so the room's ability to hear
   * depended entirely on a client round trip that is not guaranteed to arrive.
   * A turn voided by barge-in never gets `speech_end`, so a well-behaved client
   * correctly never reports it done; a backgrounded tab or a dropped frame does
   * the same thing by accident. Either way the gate stays shut, no audio is fed
   * to STT, and the room is deaf for the rest of its hour-long life — observed
   * as two working exchanges followed by nothing, with the STT socket
   * reconnecting every ~18s because it was receiving no audio at all.
   *
   * We know how much audio we sent and its sample rate, so we know when it must
   * have finished. Re-armed on every chunk, so it always trails the LAST chunk
   * rather than the first.
   */
  private armPlaybackWatchdog(): void {
    if (this.playbackWatchdog) clearTimeout(this.playbackWatchdog);
    const turn = this.activeTurn;
    if (!turn) return;
    const turnId = turn.id;
    // pcm_16000 is 16-bit mono at 16kHz — 32000 bytes per second of audio.
    const remainingMs = (turn.audioBytes / 32) - (Date.now() - turn.firstAudioAt);
    this.playbackWatchdog = setTimeout(
      () => {
        this.playbackWatchdog = null;
        if (this.closed || !this.speaking || this.activeTurn?.id !== turnId) return;
        this.deps.metric("playback_watchdog", undefined, { turnId, bytes: turn.audioBytes });
        this.endSpeaking();
      },
      Math.max(0, remainingMs) + PLAYBACK_WATCHDOG_SLACK_MS,
    );
  }

  private teardownTurnAudio(): void {
    if (this.playbackWatchdog) {
      clearTimeout(this.playbackWatchdog);
      this.playbackWatchdog = null;
    }
    // Detach BEFORE destroying. `destroy()` closes the socket, and closing a
    // socket that is already failing fires its `error` event SYNCHRONOUSLY —
    // whose handler calls this method. With the references still set, that
    // re-entry destroyed the same socket again, forever: a stack overflow
    // that took the whole room process down (seen live as the room dying the
    // moment a caller hung up during a TTS error).
    const tts = this.tts;
    this.tts = null;
    this.activeTurn = null;
    tts?.destroy();
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

    // Void the turn BEFORE tearing its audio down, so deltas still streaming
    // from the model cannot re-open a socket and resume the sentence.
    if (active) this.voidedTurns.add(active.id);
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
    return this.mesh.send({
      id: `msg_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      from: FRONT_IDENTITY.id,
      to: WORKER_ID,
      content: request,
      created_at: new Date().toISOString(),
      blocking: true,
    }).then(() => "dispatched");
  }

  /**
   * The worker's threaded reply, arriving from its signal process via the
   * room's /mesh endpoint. Handing it to the mesh adapter resolves Nova's
   * pending `mesh:waiting` item, so the findings land in her inbox exactly as
   * they would on an in-process bus; the wakeup turn then relays them (§5).
   */
  async deliverMeshMessage(message: IncomingMeshMessage): Promise<void> {
    if (this.closed) return;
    const key = message.in_reply_to ?? message.id;
    const queuedAt = this.pendingDelegations.get(key);
    this.pendingDelegations.delete(key);
    if (queuedAt) {
      this.deps.metric("delegation_roundtrip_ms", Date.now() - queuedAt, { messageId: key });
    }
    this.deps.send({ t: "delegation", jobId: key, phase: "done" });

    await this.mesh.deliver(message);
    // The inbox now carries the findings; the notice tells her what kind of
    // moment this is. Both reach the model on the same turn.
    this.enqueueTurn(frameWorkerResult(message.content));
  }

  /** A dispatched job died in its signal run — level with the caller. */
  async reportDelegationFailure(messageId: string, reason: string): Promise<void> {
    if (this.closed) return;
    this.pendingDelegations.delete(messageId);
    this.deps.send({ t: "delegation", jobId: messageId, phase: "failed", detail: reason });
    this.deps.metric("delegation_failed", undefined, { messageId, reason });
    this.enqueueTurn(frameWorkerTrouble(reason));
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  private makeSubscriber(): SubscriberAdapter {
    return {
      record: async (type, data) => {
        if (type === "text_delta") {
          this.parser?.push((data as { text: string }).text);
        } else if (type === "tool_use") {
          const d = data as { name: string };
          // Her mesh send IS the dispatch — that is what the promise backstop
          // below checks for.
          if (d.name === "glove_mesh_send_message") this.delegatedThisTurn = true;
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
