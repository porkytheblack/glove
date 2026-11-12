/**
 * Batch transcription with ElevenLabs Scribe (Scribe v3 by default).
 *
 * Server-side only: it sends your API key. Use it for recordings, uploads and
 * call audio after the fact. For live microphone audio use
 * `ElevenLabsSTTAdapter` (Scribe v3 Live).
 *
 * @example
 * import { transcribeWithElevenLabs } from "glove-voice/server";
 *
 * const result = await transcribeWithElevenLabs({
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 *   audio: await fs.readFile("meeting.mp3"),
 *   filename: "meeting.mp3",
 *   diarize: true,
 *   keyterms: ["Glove", "Foundry"],
 * });
 * for (const turn of result.turns) console.log(`${turn.speakerId}: ${turn.text}`);
 */

/** Batch Scribe models. Any other string is passed through. */
export type ElevenLabsBatchModel = "scribe_v3" | "scribe_v2" | (string & {});

export interface ElevenLabsTranscribeOptions {
  apiKey: string;

  /**
   * The audio or video to transcribe. Leave out when using `sourceUrl` or
   * `cloudStorageUrl`.
   */
  audio?: Blob | ArrayBuffer | ArrayBufferView;
  /** File name sent with `audio`; helps Scribe pick the decoder (default: "audio"). */
  filename?: string;
  /** MIME type for `audio` when it is not already a Blob. */
  mimeType?: string;

  /** A public URL of the media (e.g. a hosted file or video page). */
  sourceUrl?: string;
  /** An HTTPS URL of the media in cloud storage. */
  cloudStorageUrl?: string;

  /** Default: "scribe_v3". */
  model?: ElevenLabsBatchModel;
  /** ISO language code. Leave out to let Scribe detect it. */
  languageCode?: string;
  /** Label who speaks each word. */
  diarize?: boolean;
  /** Expected number of speakers (up to 32), to help diarization. */
  numSpeakers?: number;
  /** Diarization sensitivity; only used when `numSpeakers` is not set. */
  diarizationThreshold?: number;
  /** Tag sounds like (laughter) or (applause). */
  tagAudioEvents?: boolean;
  /** "word" (default) or "character" timings. */
  timestampsGranularity?: "none" | "word" | "character";
  /** Words and names Scribe should favor (up to 1000). */
  keyterms?: string[];
  /** Drop filler words, false starts and stutters. */
  noVerbatim?: boolean;
  /** 0–2. Higher is more varied; leave out for the model default. */
  temperature?: number;
  /** Seed for repeatable output. */
  seed?: number;
  /** Transcribe each channel separately (up to 5). */
  useMultiChannel?: boolean;

  /**
   * Further form fields, for options this helper does not name yet (for
   * example `numbers_format` or `entity_detection`). Arrays become repeated
   * fields; objects are sent as JSON.
   */
  extra?: Record<string, string | number | boolean | string[] | Record<string, unknown>>;

  /** Ask ElevenLabs not to log the request (enterprise zero-retention). */
  disableLogging?: boolean;
  /**
   * API host, for data-residency environments
   * (default: "https://api.elevenlabs.io").
   */
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface ElevenLabsTranscriptWord {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event" | (string & {});
  speaker_id?: string | null;
  /** Which audio channel the word came from (multichannel requests). */
  channel_index?: number;
  logprob?: number;
  characters?: unknown[];
}

export interface ElevenLabsSpeakerTurn {
  speakerId: string | null;
  text: string;
  start?: number;
  end?: number;
}

export interface ElevenLabsTranscript {
  text: string;
  languageCode?: string;
  languageProbability?: number;
  words: ElevenLabsTranscriptWord[];
  /** Consecutive runs of words by one speaker. One turn when not diarizing. */
  turns: ElevenLabsSpeakerTurn[];
  transcriptionId?: string;
  /**
   * One transcript per audio channel, for `useMultiChannel` requests. The
   * fields above then hold the channels merged in the order things were said.
   */
  channels?: ElevenLabsTranscript[];
  /** The response body as ElevenLabs returned it. */
  raw: unknown;
}

/**
 * Transcribe a file or URL with Scribe v3 (POST /v1/speech-to-text).
 * Throws with the status and body when ElevenLabs rejects the request.
 */
export async function transcribeWithElevenLabs(
  options: ElevenLabsTranscribeOptions,
): Promise<ElevenLabsTranscript> {
  const form = new FormData();
  form.set("model_id", options.model ?? "scribe_v3");

  const sources = [options.audio, options.sourceUrl, options.cloudStorageUrl].filter(
    (s) => s !== undefined,
  );
  if (sources.length !== 1) {
    throw new Error("transcribeWithElevenLabs: pass exactly one of audio, sourceUrl or cloudStorageUrl");
  }

  if (options.audio !== undefined) {
    const blob =
      options.audio instanceof Blob
        ? options.audio
        : new Blob([toBytes(options.audio)], options.mimeType ? { type: options.mimeType } : {});
    form.set("file", blob, options.filename ?? "audio");
  }
  if (options.sourceUrl) form.set("source_url", options.sourceUrl);
  if (options.cloudStorageUrl) form.set("cloud_storage_url", options.cloudStorageUrl);

  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value !== undefined) form.set(key, String(value));
  };
  set("language_code", options.languageCode);
  set("diarize", options.diarize);
  set("num_speakers", options.numSpeakers);
  set("diarization_threshold", options.diarizationThreshold);
  set("tag_audio_events", options.tagAudioEvents);
  set("timestamps_granularity", options.timestampsGranularity);
  set("no_verbatim", options.noVerbatim);
  set("temperature", options.temperature);
  set("seed", options.seed);
  set("use_multi_channel", options.useMultiChannel);
  for (const term of options.keyterms ?? []) form.append("keyterms", term);

  for (const [key, value] of Object.entries(options.extra ?? {})) {
    form.delete(key);
    if (Array.isArray(value)) for (const v of value) form.append(key, v);
    else if (typeof value === "object") form.set(key, JSON.stringify(value));
    else form.set(key, String(value));
  }

  const base = (options.baseUrl ?? "https://api.elevenlabs.io").replace(/\/+$/, "");
  const query = options.disableLogging ? "?enable_logging=false" : "";
  const res = await fetch(`${base}/v1/speech-to-text${query}`, {
    method: "POST",
    headers: { "xi-api-key": options.apiKey },
    body: form,
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs transcription error (${res.status}): ${text}`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return parseTranscript(raw);
}

/** @internal Shape a /v1/speech-to-text response. Exported for tests. */
export function parseTranscript(raw: Record<string, unknown>): ElevenLabsTranscript {
  // Multichannel responses wrap one transcript per channel.
  if (Array.isArray(raw.transcripts)) return mergeChannels(raw);

  const words = Array.isArray(raw.words) ? (raw.words as ElevenLabsTranscriptWord[]) : [];
  const text = typeof raw.text === "string" ? raw.text : "";
  return {
    text,
    languageCode: typeof raw.language_code === "string" ? raw.language_code : undefined,
    languageProbability:
      typeof raw.language_probability === "number" ? raw.language_probability : undefined,
    words,
    turns: words.length > 0 ? speakerTurns(words) : text ? [{ speakerId: null, text }] : [],
    transcriptionId: typeof raw.transcription_id === "string" ? raw.transcription_id : undefined,
    raw,
  };
}

/**
 * Merge per-channel transcripts into one, in the order things were said.
 * Channels are separate recordings of the same conversation, so reading all
 * of channel 0 and then all of channel 1 would put the replies out of order.
 */
function mergeChannels(raw: Record<string, unknown>): ElevenLabsTranscript {
  const entries = (raw.transcripts as Record<string, unknown>[]).map((t, i) => ({
    index: typeof t.channel_index === "number" ? t.channel_index : i,
    part: parseTranscript(t),
  }));
  const parts = entries.map((e) => e.part);

  // A channel usually is one speaker. Keep the provider's speaker ids when
  // they already differ between channels; otherwise name speakers by channel.
  const idsPerChannel = entries.map(
    (e) => new Set(e.part.words.map((w) => w.speaker_id).filter((id): id is string => !!id)),
  );
  const seen = new Set<string>();
  let distinct = idsPerChannel.every((ids) => ids.size > 0);
  for (const ids of idsPerChannel) {
    for (const id of ids) {
      if (seen.has(id)) distinct = false;
      seen.add(id);
    }
  }

  const words = entries.flatMap((e) =>
    e.part.words.map((w) => ({
      ...w,
      channel_index: w.channel_index ?? e.index,
      speaker_id: distinct ? w.speaker_id : `channel_${e.index}`,
    })),
  );
  // Without word timings there is nothing to order by, so channels stay in
  // channel order.
  const timed = words.length > 0 && words.every((w) => typeof w.start === "number");
  if (timed) {
    const order = new Map(words.map((w, i) => [w, i]));
    words.sort((a, b) => a.start! - b.start! || order.get(a)! - order.get(b)!);
  }
  const turns = words.length > 0
    ? speakerTurns(words)
    : entries
        .filter((e) => e.part.text)
        .map((e) => ({ speakerId: `channel_${e.index}`, text: e.part.text }));

  return {
    text: turns.map((t) => t.text).join("\n"),
    languageCode: parts[0]?.languageCode,
    languageProbability: parts[0]?.languageProbability,
    words,
    turns,
    transcriptionId: typeof raw.transcription_id === "string" ? raw.transcription_id : undefined,
    channels: parts,
    raw,
  };
}

function speakerTurns(words: ElevenLabsTranscriptWord[]): ElevenLabsSpeakerTurn[] {
  const turns: ElevenLabsSpeakerTurn[] = [];
  let current: ElevenLabsSpeakerTurn | null = null;
  for (const w of words) {
    if (w.type === "spacing" && current) {
      current.text += w.text;
      continue;
    }
    const speakerId = w.speaker_id ?? null;
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

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // Copy: the view may sit on a SharedArrayBuffer or a larger pooled buffer
  // (Node's Buffer), and Blob should get exactly these bytes.
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return copy;
}
