import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ElevenLabsSTTAdapter } from "../src/adapters/eleven-labs/stt";
import { parseTranscript, transcribeWithElevenLabs } from "../src/adapters/eleven-labs/batch";

// ─── A fake WebSocket that records what the adapter sends ─────────────────

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "";
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  receive(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
console.debug = () => {};
console.warn = () => {};
console.error = () => {};

async function open(cfg: Partial<ConstructorParameters<typeof ElevenLabsSTTAdapter>[0]> = {}) {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "tok", maxReconnects: 0, ...cfg });
  await stt.connect();
  return { stt, ws: FakeSocket.last! };
}

// ─── Realtime ─────────────────────────────────────────────────────────────

test("defaults to scribe_v3_live with manual commits and English", async () => {
  const { stt, ws } = await open();
  const url = new URL(ws.url);
  assert.equal(url.host, "api.elevenlabs.io");
  assert.equal(url.searchParams.get("model_id"), "scribe_v3_live");
  assert.equal(url.searchParams.get("language_code"), "en");
  assert.equal(url.searchParams.get("commit_strategy"), null);
  assert.equal(url.searchParams.get("token"), "tok");
  stt.disconnect();
});

test("vadSilenceThreshold alone still selects the vad strategy", async () => {
  const { stt, ws } = await open({ vadSilenceThreshold: 0.8 });
  const q = new URL(ws.url).searchParams;
  assert.equal(q.get("commit_strategy"), "vad");
  assert.equal(q.get("vad_silence_threshold_secs"), "0.8");
  stt.disconnect();
});

test("v3 Live options become query parameters", async () => {
  const { stt, ws } = await open({
    language: null,
    commitStrategy: "turn_prediction",
    diarize: true,
    multilangMode: true,
    keyterms: ["Glove", "Foundry"],
    secondaryLanguages: ["fr", "es"],
    includeTimestamps: true,
    noVerbatim: true,
    keepaliveIntervalMs: 2000,
    extraParams: { some_new_flag: true, keyterms: ["Override"] },
  });
  const q = new URL(ws.url).searchParams;
  assert.equal(q.get("language_code"), null);
  assert.equal(q.get("commit_strategy"), "turn_prediction");
  assert.equal(q.get("diarize"), "true");
  assert.equal(q.get("multilang_mode"), "true");
  assert.deepEqual(q.getAll("keyterms"), ["Override"]); // extraParams replace same-named params
  assert.deepEqual(q.getAll("secondary_languages"), ["fr", "es"]);
  assert.equal(q.get("include_timestamps"), "true");
  assert.equal(q.get("no_verbatim"), "true");
  assert.equal(q.get("keepalive_interval_ms"), "2000");
  assert.equal(q.get("some_new_flag"), "true");
  stt.disconnect();
});

test("previous_text rides on the first chunk only", async () => {
  const { stt, ws } = await open({ previousText: "How can I help?" });
  stt.sendAudio(new Int16Array(160));
  stt.sendAudio(new Int16Array(160));
  assert.equal(ws.sent[0].previous_text, "How can I help?");
  assert.equal(ws.sent[1].previous_text, undefined);
  assert.equal(ws.sent[0].message_type, "input_audio_chunk");
  assert.equal(ws.sent[0].sample_rate, 16000);
  stt.disconnect();
});

test("partials, turn probability and commits", async () => {
  const { stt, ws } = await open({ commitStrategy: "turn_prediction" });
  const partials: string[] = [];
  const finals: string[] = [];
  const probs: number[] = [];
  stt.on("partial", (t) => partials.push(t));
  stt.on("final", (t) => finals.push(t));
  stt.scribe.on("turn_probability", (p) => probs.push(p));

  ws.receive({ message_type: "partial_transcript", text: "hello", turn_probability: 0.2 });
  ws.receive({ message_type: "partial_transcript", text: "hello", turn_probability: 0.4 }); // keepalive repeat
  ws.receive({ message_type: "partial_transcript", text: "hello there", turn_probability: 0.95 });
  ws.receive({ message_type: "committed_transcript", text: "Hello there.", segment_index: 0 });

  assert.deepEqual(partials, ["hello", "hello", "hello there"]); // repeats pass through
  assert.deepEqual(probs, [0.2, 0.4, 0.95]);
  assert.deepEqual(finals, ["Hello there."]);
  assert.equal(stt.currentPartial, "");
  stt.disconnect();
});

test("server-side commits make a later flush a no-op", async () => {
  const { stt, ws } = await open({ commitStrategy: "turn_prediction" });
  mock.timers.enable({ apis: ["Date"] });
  try {
    const commits = () => ws.sent.filter((m) => m.commit === true).length;
    stt.sendAudio(new Int16Array(1600));
    mock.timers.tick(1000); // the speaker has been quiet for a while
    ws.receive({ message_type: "committed_transcript", text: "Done." });
    stt.flushUtterance(); // client VAD fires after Scribe already committed
    assert.equal(commits(), 0);

    stt.sendAudio(new Int16Array(1600));
    stt.flushUtterance(); // audio pending: commit
    assert.equal(commits(), 1);
  } finally {
    mock.timers.reset();
    stt.disconnect();
  }
});

test("audio sent just before a commit arrives still counts as pending", async () => {
  const { stt, ws } = await open({ commitStrategy: "turn_prediction" });
  mock.timers.enable({ apis: ["Date"] });
  try {
    stt.sendAudio(new Int16Array(1600)); // utterance A
    mock.timers.tick(1000);
    stt.sendAudio(new Int16Array(1600)); // utterance B starts
    mock.timers.tick(50);
    ws.receive({ message_type: "committed_transcript", text: "A." }); // A's commit lands late
    stt.flushUtterance(); // fallback for B must still commit
    assert.equal(ws.sent.filter((m) => m.commit === true).length, 1);
  } finally {
    mock.timers.reset();
    stt.disconnect();
  }
});

test("an uncommitted partial allows a flush even when no audio is counted as pending", async () => {
  const { stt, ws } = await open({ commitStrategy: "turn_prediction" });
  mock.timers.enable({ apis: ["Date"] });
  try {
    stt.sendAudio(new Int16Array(1600));
    mock.timers.tick(1000);
    ws.receive({ message_type: "committed_transcript", text: "A." });
    // Scribe is still working through audio it already has.
    ws.receive({ message_type: "partial_transcript", text: "and B" });
    stt.flushUtterance();
    assert.equal(ws.sent.filter((m) => m.commit === true).length, 1);
  } finally {
    mock.timers.reset();
    stt.disconnect();
  }
});

test("a rejected commit can be retried without new audio", async () => {
  const { stt, ws } = await open({ commitStrategy: "vad", vadSilenceThreshold: 0.5 });
  const commits = () => ws.sent.filter((m) => m.commit === true).length;
  stt.sendAudio(new Int16Array(1600));
  stt.flushUtterance();
  assert.equal(commits(), 1);
  stt.flushUtterance(); // nothing new: skipped
  assert.equal(commits(), 1);
  ws.receive({ message_type: "commit_throttled", error: "too little audio" });
  stt.flushUtterance(); // the first commit never happened: try again
  assert.equal(commits(), 2);
  stt.disconnect();
});

test("plain and timed commits pair by count, whatever order they arrive in", async () => {
  const { stt, ws } = await open({ includeTimestamps: true });
  const finals: string[] = [];
  stt.on("final", (t) => finals.push(t));
  const words = [{ text: "x", type: "word" }];
  ws.receive({ message_type: "committed_transcript", text: "One." });
  ws.receive({ message_type: "committed_transcript", text: "Two." });
  ws.receive({ message_type: "committed_transcript_with_timestamps", text: "One.", words });
  ws.receive({ message_type: "committed_transcript_with_timestamps", text: "Two.", words });
  assert.deepEqual(finals, ["One.", "Two."]);
  stt.disconnect();
});

test("language detection alone also pairs the timed commit", async () => {
  const { stt, ws } = await open({ includeLanguageDetection: true });
  const finals: string[] = [];
  const langs: (string | undefined)[] = [];
  stt.on("final", (t) => finals.push(t));
  stt.scribe.on("committed", (c) => langs.push(c.languageCode));
  ws.receive({ message_type: "committed_transcript", text: "Bonjour." });
  ws.receive({ message_type: "committed_transcript_with_timestamps", text: "Bonjour.", language_code: "fr" });
  assert.deepEqual(finals, ["Bonjour."]);
  assert.deepEqual(langs, [undefined, "fr"]);
  stt.disconnect();
});

test("a reconnect forgets speaker merges and tells speaker listeners", async () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "tok", diarize: true, maxReconnects: 0 });
  let resets = 0;
  stt.speakers.subscribe({ reset: () => resets++ });
  await stt.connect();
  assert.equal(resets, 0); // the first session is not a reset
  stt.handleMessage({ message_type: "speakers_merged", from_speaker_id: "speaker_1", to_speaker_id: "speaker_0" });
  assert.equal(stt.resolveSpeaker("speaker_1"), "speaker_0");
  await stt.connect();
  assert.equal(resets, 1);
  assert.equal(stt.resolveSpeaker("speaker_1"), "speaker_1");
  stt.disconnect();
});

test("an adapter can be started again after disconnect()", async () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "tok", maxReconnects: 0 });
  await stt.connect();
  const first = FakeSocket.last!;
  first.receive({ message_type: "partial_transcript", text: "left over from before" });
  stt.disconnect();

  await stt.connect();
  const second = FakeSocket.last!;
  assert.notEqual(second, first);
  // Words from the earlier session are gone: an empty commit has nothing to fall back on.
  const finals: string[] = [];
  stt.on("final", (t) => finals.push(t));
  second.receive({ message_type: "committed_transcript", text: "" });
  assert.deepEqual(finals, [""]);

  // The old socket closing late is not this session's business...
  let closed = 0;
  stt.on("close", () => closed++);
  first.onclose?.();
  assert.equal(closed, 0);
  // ...and the new one closing is reported, as on a first session.
  second.onclose?.();
  assert.equal(closed, 1);
});

test("manual strategy keeps flushing with silence padding", async () => {
  const { stt, ws } = await open();
  stt.flushUtterance();
  const commit = ws.sent.at(-1)!;
  assert.equal(commit.commit, true);
  // 5120 samples * 2 bytes, base64 → 13656 chars
  assert.equal((commit.audio_base_64 as string).length, 13656);
  stt.disconnect();
});

test("empty commit falls back to the last partial", async () => {
  const { stt, ws } = await open();
  const finals: string[] = [];
  stt.on("final", (t) => finals.push(t));
  ws.receive({ message_type: "partial_transcript", text: "No" });
  ws.receive({ message_type: "committed_transcript", text: "" });
  assert.deepEqual(finals, ["No"]);
  stt.disconnect();
});

test("words the partial showed beyond a provider commit stay uncommitted", async () => {
  const { stt, ws } = await open({ commitStrategy: "turn_prediction" });
  const partials: string[] = [];
  const finals: string[] = [];
  stt.on("partial", (t) => partials.push(t));
  stt.on("final", (t) => finals.push(t));

  // Scribe heard two utterances and commits only the first.
  ws.receive({ message_type: "partial_transcript", text: "first thing and the second thing" });
  ws.receive({ message_type: "committed_transcript", text: "First thing." });
  assert.deepEqual(finals, ["First thing."]);
  assert.equal(stt.currentPartial, "and the second thing");
  assert.equal(partials.at(-1), "and the second thing");

  // With no audio since, a flush still goes out for those words.
  const before = ws.sent.length;
  stt.flushUtterance();
  assert.equal(ws.sent.length, before + 1);
  assert.equal(ws.sent.at(-1)!.commit, true);

  // A commit we asked for covers everything sent: nothing is left over,
  // even when the partial had worded it differently.
  ws.receive({ message_type: "partial_transcript", text: "and the second thing please" });
  ws.receive({ message_type: "committed_transcript", text: "And the second thing." });
  assert.equal(stt.currentPartial, "");

  // A commit that reworded the partial, or covers all of it, leaves nothing.
  ws.receive({ message_type: "partial_transcript", text: "book a table for seven tomorrow" });
  ws.receive({ message_type: "committed_transcript", text: "Book a table for 7 tomorrow." });
  assert.equal(stt.currentPartial, "");
  ws.receive({ message_type: "partial_transcript", text: "thanks a lot" });
  ws.receive({ message_type: "committed_transcript", text: "Thanks a lot!" });
  assert.equal(stt.currentPartial, "");
  stt.disconnect();
});

test("manual commits cover everything, so no partial is carried over", async () => {
  const { stt, ws } = await open();
  ws.receive({ message_type: "partial_transcript", text: "first thing and more" });
  ws.receive({ message_type: "committed_transcript", text: "First thing." });
  assert.equal(stt.currentPartial, "");
  stt.disconnect();
});

test("timestamped commits finalize once whether or not a plain twin arrives", async () => {
  const { stt, ws } = await open({ includeTimestamps: true });
  const finals: string[] = [];
  const commits: unknown[] = [];
  stt.on("final", (t) => finals.push(t));
  stt.scribe.on("committed", (c) => commits.push(c));
  const words = [{ text: "Hi", start: 0, end: 0.3, type: "word" }];

  // Pair: plain then timed
  ws.receive({ message_type: "committed_transcript", text: "Hi" });
  ws.receive({ message_type: "committed_transcript_with_timestamps", text: "Hi", words, language_code: "en" });
  // Timed only, twice in a row
  ws.receive({ message_type: "committed_transcript_with_timestamps", text: "One", words });
  ws.receive({ message_type: "committed_transcript_with_timestamps", text: "Two", words });

  assert.deepEqual(finals, ["Hi", "One", "Two"]);
  assert.equal(commits.length, 4);
  assert.deepEqual((commits[1] as { words: unknown }).words, words);
  stt.disconnect();
});

test("diarized segments group words into speaker turns and follow merges", async () => {
  const { stt, ws } = await open({ diarize: true });
  const segments: { turns: unknown[] }[] = [];
  const merges: unknown[] = [];
  stt.scribe.on("diarized", (s) => segments.push(s));
  stt.scribe.on("speakers_merged", (m) => merges.push(m));

  ws.receive({ message_type: "speakers_merged", from_speaker_id: "speaker_2", to_speaker_id: "speaker_1" });
  ws.receive({ message_type: "speakers_merged", from_speaker_id: "speaker_3", to_speaker_id: "speaker_2" });
  ws.receive({
    message_type: "diarized_transcript",
    segment_index: 3,
    text: "Hi there. Hello.",
    words: [
      { text: "Hi", start: 0, end: 0.2, type: "word", speaker_id: "speaker_0" },
      { text: " ", type: "spacing", speaker_id: "speaker_0" },
      { text: "there.", start: 0.25, end: 0.5, type: "word", speaker_id: "speaker_0" },
      { text: " ", type: "spacing", speaker_id: null },
      { text: "Hello.", start: 0.9, end: 1.2, type: "word", speaker_id: "speaker_3" },
    ],
  });

  assert.deepEqual(merges, [
    { from: "speaker_2", to: "speaker_1" },
    { from: "speaker_3", to: "speaker_2" },
  ]);
  assert.equal(stt.resolveSpeaker("speaker_3"), "speaker_1");
  assert.deepEqual(segments[0].turns, [
    { speakerId: "speaker_0", text: "Hi there.", start: 0, end: 0.5 },
    { speakerId: "speaker_1", text: "Hello.", start: 0.9, end: 1.2 },
  ]);
  stt.disconnect();
});

test("error message types surface as errors; commit rejections as warnings", async () => {
  const { stt, ws } = await open();
  const errors: string[] = [];
  const warnings: string[] = [];
  stt.on("error", (e) => errors.push(e.message));
  stt.scribe.on("warning", (w) => warnings.push(w));

  ws.receive({ message_type: "quota_exceeded", error: "out of credits" });
  ws.receive({ message_type: "invalid_request", error: "The 'diarize' parameter is only supported by scribe_v3_live." });
  ws.receive({ message_type: "error", error: "boom" });
  ws.receive({ message_type: "commit_throttled", error: "too little audio" });

  assert.deepEqual(errors, [
    "Scribe quota_exceeded: out of credits",
    "Scribe invalid_request: The 'diarize' parameter is only supported by scribe_v3_live.",
    "boom",
  ]);
  assert.deepEqual(warnings, ["commit_throttled: too little audio"]);
  stt.disconnect();
});

// ─── Batch ────────────────────────────────────────────────────────────────

test("batch transcription posts scribe_v3 with the given options", async () => {
  const realFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({
        language_code: "en",
        language_probability: 0.99,
        text: "Hi. Hello.",
        transcription_id: "tr_1",
        words: [
          { text: "Hi.", start: 0, end: 0.3, type: "word", speaker_id: "speaker_0" },
          { text: " ", type: "spacing", speaker_id: "speaker_0" },
          { text: "Hello.", start: 0.5, end: 0.9, type: "word", speaker_id: "speaker_1" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const result = await transcribeWithElevenLabs({
      apiKey: "key",
      audio: new Uint8Array([1, 2, 3]),
      filename: "clip.wav",
      diarize: true,
      numSpeakers: 2,
      keyterms: ["Glove", "Kuiper"],
      extra: { numbers_format: "digits" },
      disableLogging: true,
    });
    const { url, init } = captured!;
    assert.equal(url, "https://api.elevenlabs.io/v1/speech-to-text?enable_logging=false");
    assert.equal((init.headers as Record<string, string>)["xi-api-key"], "key");
    const form = init.body as FormData;
    assert.equal(form.get("model_id"), "scribe_v3");
    assert.equal(form.get("diarize"), "true");
    assert.equal(form.get("num_speakers"), "2");
    assert.deepEqual(form.getAll("keyterms"), ["Glove", "Kuiper"]);
    assert.equal(form.get("numbers_format"), "digits");
    assert.equal((form.get("file") as File).name, "clip.wav");

    assert.equal(result.text, "Hi. Hello.");
    assert.equal(result.transcriptionId, "tr_1");
    assert.deepEqual(result.turns, [
      { speakerId: "speaker_0", text: "Hi.", start: 0, end: 0.3 },
      { speakerId: "speaker_1", text: "Hello.", start: 0.5, end: 0.9 },
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("batch transcription rejects ambiguous sources and reports API errors", async () => {
  await assert.rejects(
    transcribeWithElevenLabs({ apiKey: "k" }),
    /exactly one of audio, sourceUrl or cloudStorageUrl/,
  );
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("bad model", { status: 422 })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      transcribeWithElevenLabs({ apiKey: "k", sourceUrl: "https://example.com/a.mp3" }),
      /ElevenLabs transcription error \(422\): bad model/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("batch transcription refuses webhook delivery", async () => {
  await assert.rejects(
    transcribeWithElevenLabs({
      apiKey: "k",
      sourceUrl: "https://example.com/a.mp3",
      extra: { webhook: true },
    }),
    /webhook delivery is not supported/,
  );
});

test("multichannel responses are merged in the order things were said", () => {
  const word = (text: string, start: number) => ({ text, start, end: start + 0.4, type: "word", speaker_id: "speaker_0" });
  const t = parseTranscript({
    transcripts: [
      { channel_index: 0, text: "Hello there. Fine thanks.", words: [word("Hello", 0), word(" there.", 0.5), word("Fine", 3), word(" thanks.", 3.5)] },
      { channel_index: 1, text: "Hi, how are you?", words: [word("Hi,", 1.2), word(" how", 1.7), word(" are", 2.0), word(" you?", 2.3)] },
    ],
  });
  // Both channels used "speaker_0", so speakers are named by channel.
  assert.deepEqual(
    t.turns.map((turn) => [turn.speakerId, turn.text]),
    [
      ["channel_0", "Hello there."],
      ["channel_1", "Hi, how are you?"],
      ["channel_0", "Fine thanks."],
    ],
  );
  assert.equal(t.text, "Hello there.\nHi, how are you?\nFine thanks.");
  assert.equal(t.channels?.length, 2);
  assert.equal(t.channels?.[1].text, "Hi, how are you?");
  assert.deepEqual(t.words.map((w) => w.channel_index), [0, 0, 1, 1, 1, 1, 0, 0]);
});

test("multichannel without word timings keeps channel order and distinct speaker ids", () => {
  const t = parseTranscript({
    transcripts: [
      { text: "left", language_code: "en", words: [{ text: "left", type: "word", speaker_id: "speaker_0" }] },
      { text: "right", language_code: "en", words: [{ text: "right", type: "word", speaker_id: "speaker_1" }] },
    ],
  });
  assert.equal(t.text, "left\nright");
  assert.deepEqual(t.turns.map((turn) => turn.speakerId), ["speaker_0", "speaker_1"]);
});

test("detectsTurns follows the commit strategy", () => {
  const make = (cfg: Partial<ConstructorParameters<typeof ElevenLabsSTTAdapter>[0]>) =>
    new ElevenLabsSTTAdapter({ getToken: async () => "t", ...cfg });
  assert.equal(make({}).detectsTurns, false);
  assert.equal(make({ commitStrategy: "turn_prediction" }).detectsTurns, true);
  assert.equal(make({ vadSilenceThreshold: 0.6 }).detectsTurns, true);
});
