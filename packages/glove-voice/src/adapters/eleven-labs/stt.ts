import EventEmitter from "eventemitter3";
import type {
  STTAdapter,
  STTAdapterEvents,
  GetTokenFn,
  PendingSpeakers,
  SpeakerListener,
  SpeakerSource,
  SpeakerTurn,
} from "../types";
import { bytesToBase64 } from "../../base64";

/**
 * Realtime Scribe models. `scribe_v3_live` is the default. `scribe_v2_realtime`
 * still works but supports neither `diarize` nor `commitStrategy: "turn_prediction"`.
 * Any other string is passed through, so a newer model needs no release here.
 */
export type ElevenLabsRealtimeModel =
  | "scribe_v3_live"
  | "scribe_v2_realtime"
  | (string & {});

/**
 * Who decides where an utterance ends.
 *
 * - `"manual"`: the client commits. GloveVoice calls `flushUtterance()` when
 *   its VAD hears the end of speech or `commitTurn()` is called. Lowest
 *   latency with a good client VAD, and the ElevenLabs default.
 * - `"vad"`: Scribe commits after `vadSilenceThreshold` seconds of silence.
 * - `"turn_prediction"` (Scribe v3 Live only): Scribe predicts the end of the
 *   speaker's turn from what was said and how, and commits when its
 *   `turn_probability` reaches 0.9. Each partial carries the probability,
 *   emitted here as `turn_probability`.
 *
 * With GloveVoice, pair "turn_prediction" (or "vad") with `turnMode: "stt"`,
 * or GloveVoice's own VAD will commit first and override Scribe.
 */
export type ElevenLabsCommitStrategy = "manual" | "vad" | "turn_prediction";

export interface ElevenLabsSTTConfig {
  /**
   * Called to fetch a short-lived token from YOUR server.
   * Your server calls POST /v1/single-use-token/realtime_scribe.
   *
   * @example
   * getToken: () => fetch("/api/voice/stt-token").then(r => r.json()).then(d => d.token)
   */
  getToken: GetTokenFn;

  /** Scribe model (default: "scribe_v3_live") */
  model?: ElevenLabsRealtimeModel;

  /**
   * Language code (default: "en"). Pass `null` to leave it out and let
   * Scribe detect the language.
   */
  language?: string | null;

  /**
   * Who commits utterances. Defaults to `"vad"` when `vadSilenceThreshold`
   * is above 0 and to `"manual"` otherwise, which is how earlier versions of
   * this adapter behaved.
   */
  commitStrategy?: ElevenLabsCommitStrategy;

  /**
   * Seconds of silence before Scribe auto-commits an utterance (0.192–3.0).
   * A value above 0 turns on `commitStrategy: "vad"` unless another strategy
   * is set; with `"turn_prediction"` it tunes Scribe's VAD fallback.
   * (default: 0 — we manage VAD ourselves for lower latency)
   */
  vadSilenceThreshold?: number;

  /**
   * Label speakers in realtime (Scribe v3 Live only). Each commit is followed
   * by a `diarized` event whose words carry `speaker_id` ("speaker_0", ...),
   * and `speakers_merged` reports when Scribe decides two IDs are one person.
   * Cannot be combined with `filterBackgroundAudio`.
   */
  diarize?: boolean;

  /**
   * Follow speakers who switch language mid-sentence, writing each language
   * in its own script (Scribe v3 Live).
   */
  multilangMode?: boolean;

  /** Limit language identification to these codes, besides `language`. */
  secondaryLanguages?: string[];

  /** Words and names Scribe should favor, such as product names or jargon. */
  keyterms?: string[];

  /** Ask for word timings; commits then also arrive as `committed` events with `words`. */
  includeTimestamps?: boolean;

  /** Report the detected language on committed transcripts. */
  includeLanguageDetection?: boolean;

  /** Drop filler words, false starts and stutters from the transcript. */
  noVerbatim?: boolean;

  /** Suppress speech and noise in the background (not with `diarize`). */
  filterBackgroundAudio?: boolean;

  /**
   * Text that came before this session, such as the agent's last reply.
   * Sent with the first audio chunk of each connection. Works best under
   * 50 characters.
   */
  previousText?: string;

  /**
   * Interval (500–10000 ms) at which Scribe sends keepalive partials while
   * audio is streaming.
   *
   * This does not keep a silent session open: Scribe closes a session after
   * 15s with no client messages, and only audio chunks count. The adapter
   * then reconnects, which starts a new session (and new speaker ids when
   * diarizing). GloveVoice's `sttKeepAliveMs` sends an occasional mic frame
   * through a closed speech gate to prevent that.
   */
  keepaliveIntervalMs?: number;

  /**
   * Extra query parameters for the realtime WebSocket, for options this
   * adapter does not name yet. Arrays become repeated parameters.
   */
  extraParams?: Record<string, string | number | boolean | string[]>;

  /** Max auto-reconnect attempts on unexpected disconnect (default: 3) */
  maxReconnects?: number;
}

/** A word (or spacing token) with timing and, when diarizing, its speaker. */
export interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event" | (string & {});
  /** "speaker_0", "speaker_1", ... or null while Scribe has not decided. */
  speaker_id?: string | null;
  logprob?: number;
  characters?: unknown[];
}

/** A committed utterance with whatever detail the session asked for. */
export interface ScribeCommit {
  text: string;
  /** Zero-based segment number, present when diarizing. */
  segmentIndex?: number;
  languageCode?: string;
  words?: ScribeWord[];
}

/** The speaker-labelled version of a committed segment. */
export interface ScribeDiarizedSegment {
  segmentIndex: number;
  text: string;
  words: ScribeWord[];
  /** Consecutive runs of words by one speaker, with merges already applied. */
  turns: ScribeSpeakerTurn[];
}

/** A run of words by one speaker (the provider-neutral `SpeakerTurn`). */
export type ScribeSpeakerTurn = SpeakerTurn;

/**
 * Scribe-specific events, on `adapter.scribe`. They live on their own emitter
 * so the adapter itself keeps the plain `STTAdapter` event contract.
 */
export type ElevenLabsSTTEvents = {
  /** The session opened; `config` is what Scribe will actually use. */
  session_started: [info: { sessionId: string; config: unknown }];
  /** Every commit, including timestamps and language when requested. */
  committed: [commit: ScribeCommit];
  /** Speaker labels for a committed segment (`diarize: true`). */
  diarized: [segment: ScribeDiarizedSegment];
  /** Scribe decided `from` and `to` are the same speaker. */
  speakers_merged: [merge: { from: string; to: string }];
  /** Scribe v3 Live's end-of-turn probability from each partial, under every commit strategy. */
  turn_probability: [probability: number];
  /** A non-fatal notice from Scribe. */
  warning: [message: string];
};

interface ScribeMessage {
  message_type: string;
  [key: string]: unknown;
}

/**
 * Server messages that end or reject something. Each is surfaced as an
 * `error` event; the socket's own close handling decides on reconnects.
 */
const ERROR_TYPES = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "invalid_request",
  "chunk_size_exceeded",
  "transcriber_error",
]);

/**
 * Rejections of a single commit. The session keeps going, so these are
 * warnings rather than errors.
 */
const COMMIT_REJECTIONS = new Set(["commit_throttled", "insufficient_audio_activity"]);

/** Audio sent within this long before a commit arrives may be past what it covered. */
const COMMIT_LAG_MS = 300;

/**
 * ElevenLabs Scribe Realtime STT adapter (Scribe v3 Live by default).
 *
 * Auth: server-side token via getToken(). Your server calls:
 *   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe
 *   Headers: { "xi-api-key": YOUR_API_KEY }
 *
 * The token is passed as a query param to the WebSocket URL.
 *
 * Beyond the `STTAdapter` contract (`partial`, `final`, `error`, `close`),
 * `adapter.scribe` emits `committed`, `diarized`, `speakers_merged`,
 * `turn_probability`, `session_started` and `warning` for the features
 * Scribe v3 Live adds.
 *
 * @example Live diarization with turn prediction
 * const stt = new ElevenLabsSTTAdapter({
 *   getToken,
 *   diarize: true,
 *   commitStrategy: "turn_prediction",
 * });
 * stt.scribe.on("diarized", (seg) => {
 *   for (const t of seg.turns) console.log(`${t.speakerId}: ${t.text}`);
 * });
 */
export class ElevenLabsSTTAdapter
  extends EventEmitter<STTAdapterEvents>
  implements STTAdapter
{
  /** Scribe v3 Live events: diarization, turn prediction, timed commits, warnings. */
  readonly scribe = new EventEmitter<ElevenLabsSTTEvents>();

  /**
   * Who said each finalized utterance (`diarize: true`). GloveVoice reads
   * this to label the agent's input once a second speaker is heard.
   */
  readonly speakers: SpeakerSource = {
    enabled: false,
    forFinal: () => this.lastPending,
    subscribe: (listener) => {
      this.speakerListeners.add(listener);
      return () => {
        this.speakerListeners.delete(listener);
      };
    },
  };

  private ws: WebSocket | null = null;
  private partial = "";
  private reconnects = 0;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether this connection has sent audio yet (previous_text rides on the first chunk). */
  private sentFirstChunk = false;
  /** Audio sent since the last commit, ours or Scribe's. */
  private pendingAudio = false;
  /**
   * Plain and timed commits seen on this connection. With timestamps or
   * language detection on, one utterance can arrive as both; the one that
   * brings its kind's count level with the other's is the twin.
   */
  private commitCounts = { plain: 0, timed: 0 };
  /** When audio was last sent, to tell audio a commit covered from audio after it. */
  private lastAudioAt = 0;
  private hasConnected = false;
  /** Draft word labels from the latest partial (`diarize: true`). */
  private partialWords: ScribeWord[] | null = null;
  /** We asked for a commit and Scribe has not answered. Its commit covers everything sent. */
  private ownCommitPending = false;
  /** Commits whose settled speaker labels have not arrived yet, oldest first. */
  private awaitingDiarized: {
    segmentIndex?: number;
    resolve: (turns: SpeakerTurn[] | null) => void;
  }[] = [];
  /** Speaker labels for the commit most recently emitted as `final`. */
  private lastPending: PendingSpeakers = { draft: null, settled: Promise.resolve(null) };
  private readonly speakerListeners = new Set<SpeakerListener>();
  /** Scribe's latest end-of-turn probability, for the current partial. */
  private latestTurnProbability: number | null = null;
  /** Speaker merges Scribe announced, from → to. */
  private readonly merges = new Map<string, string>();

  private readonly model: string;
  private readonly language: string | null;
  private readonly vadThreshold: number;
  private readonly commitStrategy: ElevenLabsCommitStrategy;
  private readonly maxReconnects: number;

  constructor(private readonly cfg: ElevenLabsSTTConfig) {
    super();
    this.model = cfg.model ?? "scribe_v3_live";
    this.language = cfg.language === undefined ? "en" : cfg.language;
    this.vadThreshold = cfg.vadSilenceThreshold ?? 0;
    this.commitStrategy = cfg.commitStrategy ?? (this.vadThreshold > 0 ? "vad" : "manual");
    this.maxReconnects = cfg.maxReconnects ?? 3;
    (this.speakers as { enabled: boolean }).enabled = cfg.diarize === true;
  }

  /**
   * The realtime WebSocket query string for this configuration. Exposed for
   * tests and debugging. Built by hand rather than with `URLSearchParams`
   * mutators, which older React Native polyfills do not implement.
   */
  buildQuery(token: string): string {
    const cfg = this.cfg;
    const pairs: [string, string][] = [
      ["token", token],
      ["model_id", this.model],
      ["audio_format", "pcm_16000"],
    ];
    const add = (key: string, value: string | number | boolean) => pairs.push([key, String(value)]);

    if (this.language) add("language_code", this.language);
    if (this.commitStrategy !== "manual") add("commit_strategy", this.commitStrategy);
    if (this.vadThreshold > 0 && this.commitStrategy !== "manual") {
      add("vad_silence_threshold_secs", this.vadThreshold);
    }
    if (cfg.diarize) add("diarize", true);
    if (cfg.multilangMode) add("multilang_mode", true);
    if (cfg.includeTimestamps) add("include_timestamps", true);
    if (cfg.includeLanguageDetection) add("include_language_detection", true);
    if (cfg.noVerbatim) add("no_verbatim", true);
    if (cfg.filterBackgroundAudio) add("filter_background_audio", true);
    if (cfg.keepaliveIntervalMs !== undefined) add("keepalive_interval_ms", cfg.keepaliveIntervalMs);
    for (const lang of cfg.secondaryLanguages ?? []) add("secondary_languages", lang);
    for (const term of cfg.keyterms ?? []) add("keyterms", term);

    // extraParams replace any parameter of the same name.
    let out = pairs;
    for (const [key, value] of Object.entries(cfg.extraParams ?? {})) {
      out = out.filter(([k]) => k !== key);
      for (const v of Array.isArray(value) ? value : [value]) out.push([key, String(v)]);
    }
    return out.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }

  async connect(): Promise<void> {
    const token = await this.cfg.getToken();

    return new Promise((resolve, reject) => {
      const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${this.buildQuery(token)}`;

      // A fresh session, also after disconnect(): an adapter can be started
      // again, and must then reconnect on a drop and report a close as usual.
      this.destroyed = false;
      this.partial = "";
      this.sentFirstChunk = false;
      this.pendingAudio = false;
      this.ownCommitPending = false;
      this.commitCounts = { plain: 0, timed: 0 };
      this.latestTurnProbability = null;
      // A new session numbers its speakers from scratch: "speaker_0" may now
      // be someone else, so earlier merges no longer apply.
      this.merges.clear();
      if (this.hasConnected) for (const l of this.speakerListeners) l.reset?.();
      this.partialWords = null;
      // Labels for commits on the old connection will never arrive.
      this.dropAwaitingSpeakers();
      const socket = new WebSocket(url);
      this.ws = socket;
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.hasConnected = true;
        this.reconnects = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        let data: ScribeMessage;
        try {
          data = JSON.parse(event.data as string) as ScribeMessage;
        } catch {
          // Binary frame — not expected from Scribe
          return;
        }
        this.handleMessage(data);
      };

      this.ws.onerror = () => {
        const err = new Error("ElevenLabs STT WebSocket error");
        this.emit("error", err);
        reject(err);
      };

      this.ws.onclose = () => {
        // A socket that disconnect() closed, or that a newer connection has
        // replaced: its close says nothing about the current session.
        if (this.ws !== socket) return;
        if (!this.destroyed && this.reconnects < this.maxReconnects) {
          this.reconnects++;
          this.reconnectTimer = setTimeout(() => {
            // A reconnect's failure must never become an UNHANDLED rejection.
            // `connect()` both rejects on a socket error and throws when the
            // token mint fails, and nobody awaits it on this path — so a
            // transient 5xx from the token endpoint (seen live as a DNS blip
            // returning 503) took down the entire host process. For a voice
            // gateway that means the room dies mid-call and the caller's
            // microphone goes permanently dead. Surface it and let the next
            // close event schedule the following attempt instead.
            this.connect().catch((err: unknown) => {
              this.emit(
                "error",
                err instanceof Error ? err : new Error(String(err)),
              );
              if (this.reconnects >= this.maxReconnects && !this.destroyed) {
                this.emit("close");
              }
            });
          }, 500 * this.reconnects);
        } else {
          // Nothing more will arrive on this connection.
          this.dropAwaitingSpeakers();
          if (!this.destroyed) this.emit("close");
        }
      };
    });
  }

  /** @internal Exposed for tests: feed one parsed server message. */
  handleMessage(data: ScribeMessage): void {
    const type = data.message_type;
    switch (type) {
      case "session_started":
        console.debug(`[ElevenLabsSTT] session started`, data.session_id);
        this.scribe.emit("session_started", {
          sessionId: String(data.session_id ?? ""),
          config: data.config,
        });
        return;

      case "partial_transcript": {
        const text = typeof data.text === "string" ? data.text : "";
        if (typeof data.turn_probability === "number") {
          this.latestTurnProbability = data.turn_probability;
          this.scribe.emit("turn_probability", data.turn_probability);
        }
        // When diarizing, partials carry draft words with speaker ids.
        if (Array.isArray(data.words)) this.partialWords = data.words as ScribeWord[];
        // Repeated partials (Scribe re-sends the current text while audio
        // flows, and as keepalives) are passed through unchanged: consumers
        // use their arrival as a liveness signal.
        console.debug(`[ElevenLabsSTT] partial: "${text}"`);
        this.partial = text;
        this.emit("partial", text);
        return;
      }

      case "committed_transcript":
      case "committed_transcript_with_timestamps": {
        const kind = type === "committed_transcript" ? "plain" : "timed";
        const raw = typeof data.text === "string" ? data.text : "";
        const commit: ScribeCommit = { text: raw };
        if (typeof data.segment_index === "number") commit.segmentIndex = data.segment_index;
        if (typeof data.language_code === "string") commit.languageCode = data.language_code;
        if (Array.isArray(data.words)) commit.words = data.words as ScribeWord[];

        // With timestamps or language detection on, one utterance can arrive
        // as both a plain and a timed commit. The first finalizes it; the
        // second only adds detail, so the turn is never taken twice. Twins are
        // matched by count, not by adjacency, so two plain commits followed
        // by their two timed twins still pair up.
        if (this.cfg.includeTimestamps || this.cfg.includeLanguageDetection) {
          const other = kind === "plain" ? "timed" : "plain";
          const isTwin = this.commitCounts[kind] < this.commitCounts[other];
          this.commitCounts[kind] += 1;
          if (isTwin) {
            this.scribe.emit("committed", commit);
            return;
          }
        }

        // ElevenLabs sometimes returns an empty committed transcript for
        // short utterances ("No", "Hi") when we flush with a silence frame.
        // Fall back to the last partial — it's what Scribe actually heard.
        const text = raw || this.partial;
        console.debug(`[ElevenLabsSTT] committed: "${raw}"${raw ? "" : ` (using partial: "${text}")`}`);
        // When Scribe ends the turn itself, it can commit only the first part
        // of what the last partial showed: the rest belongs to the next
        // utterance. Those words are heard but not committed, and Scribe may
        // not repeat them until more audio arrives. Keep them as the partial.
        const leftover =
          raw && this.commitStrategy !== "manual" && !this.ownCommitPending
            ? wordsBeyond(this.partial, raw)
            : "";
        this.ownCommitPending = false;
        this.partial = leftover;
        // Scribe does not say how much audio a commit covered. Audio sent just
        // before the commit arrived may belong to the next utterance, so it
        // still counts as pending.
        this.pendingAudio = Date.now() - this.lastAudioAt < COMMIT_LAG_MS;
        this.latestTurnProbability = null;
        this.trackCommitSpeakers(commit);
        this.scribe.emit("committed", { ...commit, text });
        this.emit("final", text);
        if (leftover) {
          console.debug(`[ElevenLabsSTT] still uncommitted: "${leftover}"`);
          this.emit("partial", leftover);
        }
        return;
      }

      case "diarized_transcript": {
        const words = Array.isArray(data.words) ? (data.words as ScribeWord[]) : [];
        const segment: ScribeDiarizedSegment = {
          segmentIndex: typeof data.segment_index === "number" ? data.segment_index : -1,
          text: typeof data.text === "string" ? data.text : "",
          words,
          turns: this.speakerTurns(words),
        };
        this.settleCommitSpeakers(segment);
        this.scribe.emit("diarized", segment);
        return;
      }

      case "speakers_merged": {
        const from = String(data.from_speaker_id ?? "");
        const to = String(data.to_speaker_id ?? "");
        if (from && to) {
          this.merges.set(from, to);
          for (const l of this.speakerListeners) l.merged?.(from, to);
          this.scribe.emit("speakers_merged", { from, to });
        }
        return;
      }

      case "warning": {
        const message = String(data.warning ?? data.message ?? "");
        console.warn(`[ElevenLabsSTT] warning:`, message);
        this.scribe.emit("warning", message);
        return;
      }
    }

    if (COMMIT_REJECTIONS.has(type)) {
      // The commit did not happen, so that audio is still uncommitted and a
      // later flush must be allowed to try again.
      this.ownCommitPending = false;
      this.pendingAudio = true;
      const message = `${type}: ${String(data.error ?? "")}`;
      console.warn(`[ElevenLabsSTT] ${message}`);
      this.scribe.emit("warning", message);
      return;
    }

    if (ERROR_TYPES.has(type)) {
      console.error(`[ElevenLabsSTT] ${type}:`, JSON.stringify(data));
      const detail = String(data.error ?? data.message ?? "unknown error");
      this.emit("error", new Error(type === "error" ? detail : `Scribe ${type}: ${detail}`));
      return;
    }

    console.debug(`[ElevenLabsSTT] unknown message:`, JSON.stringify(data));
  }

  /**
   * The speaker an ID now refers to, following every merge Scribe announced.
   * Speaker IDs are never reused, so a chain always ends.
   */
  resolveSpeaker(id: string): string {
    let current = id;
    const seen = new Set<string>();
    while (this.merges.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.merges.get(current)!;
    }
    return current;
  }

  /** Settle every commit still waiting for speaker labels with "none". */
  private dropAwaitingSpeakers(): void {
    for (const waiting of this.awaitingDiarized.splice(0)) waiting.resolve(null);
  }

  /** A commit was just finalized: set up its speaker labels (draft now, settled later). */
  private trackCommitSpeakers(commit: ScribeCommit): void {
    if (!this.speakers.enabled) return;
    const words = this.partialWords;
    this.partialWords = null;
    const draftTurns =
      words && words.some((w) => w.speaker_id) ? this.speakerTurns(words) : [];
    let resolve!: (turns: SpeakerTurn[] | null) => void;
    const settled = new Promise<SpeakerTurn[] | null>((r) => {
      resolve = r;
    });
    this.awaitingDiarized.push({
      ...(commit.segmentIndex !== undefined ? { segmentIndex: commit.segmentIndex } : {}),
      resolve,
    });
    // Labels that never come must not pile up.
    while (this.awaitingDiarized.length > 32) this.awaitingDiarized.shift()!.resolve(null);
    this.lastPending = { draft: draftTurns.length > 0 ? draftTurns : null, settled };
  }

  /** Scribe sent the settled labels for a commit. They arrive in commit order. */
  private settleCommitSpeakers(segment: ScribeDiarizedSegment): void {
    if (!this.speakers.enabled) return;
    let at = this.awaitingDiarized.findIndex(
      (w) => w.segmentIndex !== undefined && w.segmentIndex === segment.segmentIndex,
    );
    if (at === -1) at = this.awaitingDiarized.findIndex((w) => w.segmentIndex === undefined);
    if (at !== -1) {
      // Anything older was skipped by Scribe.
      for (const skipped of this.awaitingDiarized.splice(0, at)) skipped.resolve(null);
      this.awaitingDiarized.shift()!.resolve(segment.turns);
    }
    for (const l of this.speakerListeners) l.segment?.(segment.turns);
  }

  private speakerTurns(words: ScribeWord[]): ScribeSpeakerTurn[] {
    const turns: ScribeSpeakerTurn[] = [];
    let current: ScribeSpeakerTurn | null = null;
    for (const w of words) {
      const raw = w.speaker_id ?? null;
      // Spacing tokens belong to whoever is talking around them.
      if (w.type === "spacing" && current) {
        current.text += w.text;
        continue;
      }
      const speakerId = raw === null ? null : this.resolveSpeaker(raw);
      if (!current || current.speakerId !== speakerId) {
        if (current) current.text = current.text.trim();
        current = { speakerId, text: "" };
        if (w.start !== undefined) current.start = w.start;
        turns.push(current);
      }
      current.text += w.text;
      if (w.end !== undefined) current.end = w.end;
    }
    if (current) current.text = current.text.trim();
    return turns.filter((t) => t.text.length > 0);
  }

  sendAudio(pcm: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: int16ToBase64(pcm),
      commit: false,
      sample_rate: 16000,
    };
    if (!this.sentFirstChunk && this.cfg.previousText) {
      msg.previous_text = this.cfg.previousText;
    }
    this.sentFirstChunk = true;
    this.pendingAudio = true;
    this.lastAudioAt = Date.now();
    this.ws.send(JSON.stringify(msg));
  }

  flushUtterance(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // When Scribe commits on its own (vad, turn_prediction) it may already
    // have closed this utterance. Committing again would only send silence
    // and get an empty transcript back.
    // An uncommitted partial is uncommitted speech, whatever the flag says.
    if (this.commitStrategy !== "manual" && !this.pendingAudio && !this.partial.trim()) return;
    // Scribe rejects a commit with less than 0.3s of uncommitted audio
    // ("commit_throttled"), and a rejected commit is invisible: the caller
    // believes the buffer was cleared while Scribe keeps accumulating, so the
    // next utterance arrives glued to the last one. Send enough silence to
    // clear that bar. It costs 320ms of padding at an utterance boundary,
    // where the speaker has already stopped.
    const silence = new Int16Array(5120); // 0.32s at 16kHz — over Scribe's 0.3s floor
    const msg: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: int16ToBase64(silence),
      commit: true,
      sample_rate: 16000,
    };
    if (!this.sentFirstChunk && this.cfg.previousText) {
      msg.previous_text = this.cfg.previousText;
    }
    this.sentFirstChunk = true;
    this.pendingAudio = false;
    this.ownCommitPending = true;
    this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.destroyed = true;
    this.dropAwaitingSpeakers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentPartial(): string {
    return this.partial;
  }

  /**
   * Scribe v3 Live's end-of-turn probability for the current partial, or null
   * before the first partial of an utterance and on models that do not send
   * one. Sent under every commit strategy, so `ProviderTurnDetector` can use
   * it while commits stay manual.
   */
  get turnProbability(): number | null {
    return this.latestTurnProbability;
  }

  /**
   * True when Scribe commits on its own (`commitStrategy` "turn_prediction"
   * or "vad"), so GloveVoice can use `turnMode: "stt"`.
   */
  get detectsTurns(): boolean {
    return this.commitStrategy !== "manual";
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function int16ToBase64(pcm: Int16Array): string {
  // Pure-JS base64 — works in browsers AND React Native (no btoa in Hermes).
  return bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

/**
 * What `partial` says after the words of `committed`. Empty unless the
 * partial starts with exactly those words (ignoring case and punctuation)
 * and goes on, so a commit that reworded the partial leaves nothing over.
 */
function wordsBeyond(partial: string, committed: string): string {
  const wordsOf = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const done = wordsOf(committed);
  const tokens = partial.trim().split(/\s+/);
  let matched = 0;
  let at = 0;
  while (at < tokens.length && matched < done.length) {
    const words = wordsOf(tokens[at]);
    if (matched + words.length > done.length) return "";
    for (const w of words) if (w !== done[matched++]) return "";
    at += 1;
  }
  if (matched < done.length) return "";
  const rest = tokens.slice(at).join(" ");
  return wordsOf(rest).length > 0 ? rest : "";
}
