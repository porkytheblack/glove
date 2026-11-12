import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "eventemitter3";
import { SpeakerTracker, createNameSpeakerTool } from "../src/speakers";
import { ElevenLabsSTTAdapter } from "../src/adapters/eleven-labs/stt";
import { GloveVoice } from "../src/voice";
import type {
  AudioIO,
  PendingSpeakers,
  SpeakerListener,
  SpeakerSource,
  SpeakerTurn,
  STTAdapterEvents,
  TTSAdapterEvents,
} from "../src/adapters/types";

console.debug = () => {};

// ─── SpeakerTracker ────────────────────────────────────────────────────────

test("labels speakers in order of appearance and formats lines", () => {
  const t = new SpeakerTracker();
  const text = t.format([
    { speakerId: "speaker_0", text: "Can you book a table" },
    { speakerId: null, text: "for" },
    { speakerId: "speaker_0", text: "seven?" },
    { speakerId: "speaker_1", text: "Make it seven thirty." },
  ]);
  assert.equal(text, "[Speaker A] Can you book a table for seven?\n[Speaker B] Make it seven thirty.");
  assert.equal(t.count, 2);
});

test("stats, shares and the dominant speaker", () => {
  const t = new SpeakerTracker();
  t.record([{ speakerId: "speaker_0", text: "one two three", start: 0, end: 3 }], 1_000);
  t.record([{ speakerId: "speaker_1", text: "four", start: 3, end: 4 }], 2_000);
  const [a, b] = t.list();
  assert.equal(a.talkMs, 3000);
  assert.equal(a.words, 3);
  assert.equal(a.share, 0.75);
  assert.equal(b.share, 0.25);
  assert.equal(t.dominant()?.label, "Speaker A");

  // Recently, only B has talked.
  t.record([{ speakerId: "speaker_1", text: "five six", start: 60, end: 62 }], 100_000);
  assert.equal(t.dominant(10_000, 101_000)?.label, "Speaker B");
  assert.equal(t.dominant()?.label, "Speaker A");
});

test("without word timings, shares fall back to word counts", () => {
  const t = new SpeakerTracker();
  t.record([
    { speakerId: "a", text: "one two three" },
    { speakerId: "b", text: "four" },
  ]);
  assert.equal(t.list()[0].share, 0.75);
});

test("names replace labels; merges fold stats and leave a note for the model", () => {
  const t = new SpeakerTracker();
  t.record([
    { speakerId: "speaker_0", text: "hello there", start: 0, end: 1 },
    { speakerId: "speaker_1", text: "hi", start: 1, end: 2 },
    { speakerId: "speaker_2", text: "me again", start: 2, end: 3 },
  ]);
  t.format([{ speakerId: "speaker_2", text: "me again" }]); // the model has seen "Speaker C"
  assert.equal(t.name("Speaker A", "Sarah"), true);
  assert.equal(t.name("nobody", "X"), false);
  assert.equal(t.label("speaker_0"), "Sarah");

  t.merge("speaker_2", "speaker_0");
  assert.equal(t.count, 2);
  assert.equal(t.label("speaker_2"), "Sarah");
  assert.equal(t.list()[0].talkMs, 2000);
  const note = t.describe();
  assert.match(note, /Speaker C turned out to be the same person as Sarah\./);
  assert.match(note, /Speakers so far: Sarah \(67% of the talking\), Speaker B \(33% of the talking\)\./);
});

test("name_speaker tool reports success and unknown speakers", async () => {
  const t = new SpeakerTracker();
  t.observe([{ speakerId: "speaker_0", text: "hi" }]);
  const tool = createNameSpeakerTool((s, n) => t.name(s, n));
  assert.equal((await tool.do({ speaker: "Speaker A", name: "Sarah" })).status, "success");
  assert.equal((await tool.do({ speaker: "Speaker Z", name: "Bob" })).status, "error");
  assert.equal(t.label("speaker_0"), "Sarah");
});

// ─── ElevenLabsSTTAdapter as a SpeakerSource ───────────────────────────────

const WORDS = [
  { text: "Hi", start: 0, end: 0.2, type: "word", speaker_id: "speaker_0" },
  { text: " ", type: "spacing", speaker_id: "speaker_0" },
  { text: "there.", start: 0.25, end: 0.5, type: "word", speaker_id: "speaker_0" },
  { text: " ", type: "spacing", speaker_id: null },
  { text: "Hello.", start: 0.9, end: 1.2, type: "word", speaker_id: "speaker_1" },
];

test("the adapter gives draft labels at commit and settled labels after", async () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "t", diarize: true });
  assert.equal(stt.speakers.enabled, true);
  const segments: SpeakerTurn[][] = [];
  const merges: string[] = [];
  stt.speakers.subscribe({
    segment: (turns) => segments.push(turns),
    merged: (from, to) => merges.push(`${from}>${to}`),
  });
  let pending: PendingSpeakers | null = null;
  stt.on("final", () => {
    pending = stt.speakers.forFinal();
  });

  stt.handleMessage({ message_type: "partial_transcript", text: "Hi there. Hello.", words: WORDS });
  stt.handleMessage({ message_type: "committed_transcript", text: "Hi there. Hello.", segment_index: 0 });
  assert.deepEqual(pending!.draft!.map((t) => t.speakerId), ["speaker_0", "speaker_1"]);

  stt.handleMessage({
    message_type: "diarized_transcript",
    segment_index: 0,
    text: "Hi there. Hello.",
    words: WORDS,
  });
  const settled = await pending!.settled;
  assert.deepEqual(settled, [
    { speakerId: "speaker_0", text: "Hi there.", start: 0, end: 0.5 },
    { speakerId: "speaker_1", text: "Hello.", start: 0.9, end: 1.2 },
  ]);
  assert.equal(segments.length, 1);

  stt.handleMessage({ message_type: "speakers_merged", from_speaker_id: "speaker_1", to_speaker_id: "speaker_0" });
  assert.deepEqual(merges, ["speaker_1>speaker_0"]);
});

test("settled labels match commits by segment index, and skipped ones resolve null", async () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "t", diarize: true });
  const pendings: PendingSpeakers[] = [];
  stt.on("final", () => pendings.push(stt.speakers.forFinal()));
  stt.handleMessage({ message_type: "committed_transcript", text: "One.", segment_index: 0 });
  stt.handleMessage({ message_type: "committed_transcript", text: "Two.", segment_index: 1 });
  assert.equal(pendings[0].draft, null);
  stt.handleMessage({
    message_type: "diarized_transcript",
    segment_index: 1,
    text: "Two.",
    words: [{ text: "Two.", type: "word", speaker_id: "speaker_0" }],
  });
  assert.equal(await pendings[0].settled, null);
  assert.deepEqual(await pendings[1].settled, [{ speakerId: "speaker_0", text: "Two." }]);
});

test("disconnect settles speaker labels that are still awaited", async () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "t", diarize: true });
  let pending: PendingSpeakers | null = null;
  stt.on("final", () => {
    pending = stt.speakers.forFinal();
  });
  stt.handleMessage({ message_type: "committed_transcript", text: "Bye.", segment_index: 0 });
  stt.disconnect();
  assert.equal(await pending!.settled, null);
});

test("without diarize the adapter is not a speaker source", () => {
  const stt = new ElevenLabsSTTAdapter({ getToken: async () => "t" });
  assert.equal(stt.speakers.enabled, false);
});

// ─── GloveVoice ────────────────────────────────────────────────────────────

class FakeSTT extends EventEmitter<STTAdapterEvents> {
  currentPartial = "";
  isConnected = true;
  private speakerListeners = new Set<SpeakerListener>();
  private next: PendingSpeakers = { draft: null, settled: Promise.resolve(null) };
  private settle: ((turns: SpeakerTurn[] | null) => void) | null = null;
  readonly speakers: SpeakerSource = {
    enabled: true,
    forFinal: () => this.next,
    subscribe: (l) => {
      this.speakerListeners.add(l);
      return () => this.speakerListeners.delete(l);
    },
  };
  async connect() {}
  sendAudio() {}
  flushUtterance() {}
  disconnect() {}
  /** Finalize an utterance. Settled labels arrive when `diarize()` is called. */
  say(text: string, draft: SpeakerTurn[] | null = null) {
    const settled = new Promise<SpeakerTurn[] | null>((r) => (this.settle = r));
    this.next = { draft, settled };
    this.emit("final", text);
  }
  diarize(turns: SpeakerTurn[]) {
    this.settle?.(turns);
    for (const l of this.speakerListeners) l.segment?.(turns);
  }
  merge(from: string, to: string) {
    for (const l of this.speakerListeners) l.merged?.(from, to);
  }
  /** The STT session reconnected: speaker ids start over. */
  reconnect() {
    for (const l of this.speakerListeners) l.reset?.();
  }
}

class FakeTTS extends EventEmitter<TTSAdapterEvents> {
  isReady = true;
  async open() {}
  sendText() {}
  flush() {
    this.emit("done");
  }
  destroy() {}
}

function setup(speakers?: ConstructorParameters<typeof GloveVoice>[1]["speakers"]) {
  const stt = new FakeSTT();
  const audio: AudioIO = {
    createCapture: () => {
      const c = new EventEmitter() as never as ReturnType<AudioIO["createCapture"]>;
      (c as unknown as { init: () => Promise<void> }).init = async () => {};
      (c as unknown as { destroy: () => Promise<void> }).destroy = async () => {};
      return c;
    },
    createPlayer: () => ({
      async init() {},
      enqueue() {},
      onDrained(cb: () => void) {
        cb();
      },
      stop() {},
      async destroy() {},
    }),
  };
  const requests: string[] = [];
  const providers: (() => unknown)[] = [];
  const glove = {
    displayManager: { resolverStore: new Map(), clearStack: async () => {} },
    addSubscriber() {},
    removeSubscriber() {},
    addContextProvider(p: () => unknown) {
      providers.push(p);
      return () => providers.splice(providers.indexOf(p), 1);
    },
    async processRequest(text: string) {
      requests.push(text);
      return {};
    },
  };
  const voice = new GloveVoice(glove as never, {
    stt,
    createTTS: () => new FakeTTS(),
    turnMode: "manual",
    startMuted: false,
    audio,
    ...(speakers !== undefined ? { speakers } : {}),
  });
  const context = () => providers.map((p) => p()).filter(Boolean).join("\n");
  return { voice, stt, requests, context, providers };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

const A = (text: string): SpeakerTurn => ({ speakerId: "speaker_0", text, start: 0, end: 2 });
const B = (text: string): SpeakerTurn => ({ speakerId: "speaker_1", text, start: 2, end: 3 });

test("one speaker: the agent gets plain text and no context note", async () => {
  const { voice, stt, requests, context } = setup();
  await voice.start();
  stt.say("Book a table.");
  stt.diarize([A("Book a table.")]);
  await flush();
  assert.deepEqual(requests, ["Book a table."]);
  assert.equal(context(), "");
  assert.equal(voice.speakers.length, 1);

  // Same lone speaker, known from the draft: no wait at all.
  stt.say("For two.", [A("For two.")]);
  await flush();
  assert.deepEqual(requests, ["Book a table.", "For two."]);
  await voice.stop();
});

test("a second speaker turns labels on, and they stay on", async () => {
  const { voice, stt, requests, context } = setup();
  const transcripts: string[] = [];
  const turnsSeen: unknown[] = [];
  voice.on("transcript", (t, partial) => !partial && transcripts.push(t));
  voice.on("speaker_turns", (t) => turnsSeen.push(t));
  await voice.start();

  stt.say("Book a table.");
  stt.diarize([A("Book a table.")]);
  await flush();

  stt.say("For seven? Make it seven thirty.");
  stt.diarize([A("For seven?"), B("Make it seven thirty.")]);
  await flush();
  assert.equal(requests[1], "[Speaker A] For seven?\n[Speaker B] Make it seven thirty.");
  // The UI transcript stays clean.
  assert.equal(transcripts[1], "For seven? Make it seven thirty.");
  assert.equal(turnsSeen.length, 2);
  assert.match(context(), /<voice-speakers>[\s\S]*Speakers so far: Speaker A \(\d+% of the talking\), Speaker B/);

  stt.say("Thanks.");
  stt.diarize([A("Thanks.")]);
  await flush();
  assert.equal(requests[2], "[Speaker A] Thanks.");
  assert.equal(voice.dominantSpeaker()?.label, "Speaker A");
  await voice.stop();
});

test("labels that do not arrive in time fall back to the draft, then to plain text", async () => {
  const { voice, stt, requests } = setup({ label: "always", waitMs: 200 });
  await voice.start();

  stt.say("Hello. Hi.", [A("Hello."), B("Hi.")]);
  await flush();
  assert.equal(requests.length, 0); // still waiting
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[0], "[Speaker A] Hello.\n[Speaker B] Hi.");

  stt.say("No labels at all.");
  await flush();
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[1], "No labels at all.");
  await voice.stop();
});

test("utterances keep their order while labels are awaited", async () => {
  const { voice, stt, requests } = setup({ label: "always", waitMs: 300 });
  await voice.start();
  stt.say("First.");
  stt.say("Second.", [A("Second.")]);
  await flush();
  mock.timers.tick(300);
  await flush();
  mock.timers.tick(300);
  await flush();
  assert.deepEqual(requests, ["First.", "[Speaker A] Second."]);
  await voice.stop();
});

test("names, preset names and merges", async () => {
  const { voice, stt, requests, context } = setup({ label: "always", names: { speaker_1: "Dan" } });
  const lists: number[] = [];
  voice.on("speakers", (l) => lists.push(l.length));
  await voice.start();

  stt.say("Hi. Hey.");
  stt.diarize([A("Hi."), B("Hey.")]);
  await flush();
  assert.equal(requests[0], "[Speaker A] Hi.\n[Dan] Hey.");

  assert.equal(voice.nameSpeaker("Speaker A", "Sarah"), true);
  stt.say("It's me.");
  stt.diarize([{ speakerId: "speaker_2", text: "It's me.", start: 5, end: 6 }]);
  await flush();
  assert.equal(requests[1], "[Speaker C] It's me.");

  stt.merge("speaker_2", "speaker_0");
  assert.equal(voice.speakers.length, 2);
  assert.match(context(), /Speaker C turned out to be the same person as Sarah\./);
  assert.ok(lists.length >= 3);
  await voice.stop();
});

test('label "never" tracks speakers without changing the agent input; false ignores them', async () => {
  const never = setup({ label: "never" });
  await never.voice.start();
  never.stt.say("Hi. Hey.", [A("Hi."), B("Hey.")]);
  never.stt.diarize([A("Hi."), B("Hey.")]);
  await flush();
  assert.deepEqual(never.requests, ["Hi. Hey."]);
  assert.equal(never.voice.speakers.length, 2);
  assert.equal(never.context(), "");
  await never.voice.stop();

  const off = setup(false);
  await off.voice.start();
  off.stt.say("Hi. Hey.", [A("Hi."), B("Hey.")]);
  off.stt.diarize([A("Hi."), B("Hey.")]);
  await flush();
  assert.deepEqual(off.requests, ["Hi. Hey."]);
  assert.equal(off.voice.speakers.length, 0);
  assert.equal(off.providers.length, 0);
  await off.voice.stop();
});

test("stop() removes the context provider and drops queued utterances", async () => {
  const { voice, stt, requests, providers } = setup({ label: "always", waitMs: 500 });
  await voice.start();
  assert.equal(providers.length, 1);
  stt.say("Too late.");
  await flush();
  await voice.stop();
  mock.timers.tick(500);
  await flush();
  assert.deepEqual(requests, []);
  assert.equal(providers.length, 0);
});

test("draft labels never replace the finalized text", async () => {
  const { voice, stt, requests } = setup({ label: "always", waitMs: 200 });
  await voice.start();

  // One speaker in the draft, which stops short of the final: label the final.
  stt.say("Book a table for seven.", [A("Book a table")]);
  await flush();
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[0], "[Speaker A] Book a table for seven.");

  // Two speakers in a draft that does not cover the final: no way to place
  // the missing words, so the agent gets the plain final.
  stt.say("Hi there. Hello, who is this?", [A("Hi there."), B("Hello,")]);
  await flush();
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[1], "Hi there. Hello, who is this?");

  // Punctuation and case differences are not a mismatch, and the agent
  // reads the final's wording, split where the speakers change.
  stt.say("OK. Thanks!", [A("ok"), B("thanks")]);
  await flush();
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[2], "[Speaker A] OK.\n[Speaker B] Thanks!");

  // A draft that heard a statement must not turn the final's question into one.
  stt.say("Are you ready? Yes, I am.", [A("Are you ready."), B("yes I am")]);
  await flush();
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[3], "[Speaker A] Are you ready?\n[Speaker B] Yes, I am.");

  // A speaker change inside one token of the final cannot be placed.
  stt.say("Twenty-five.", [A("twenty"), B("five")]);
  await flush();
  mock.timers.tick(200);
  await flush();
  assert.equal(requests[4], "Twenty-five.");
  await voice.stop();
});

test("an utterance queued before stop() does not touch the next session's speakers", async () => {
  const { voice, stt, requests } = setup({ label: "always", waitMs: 500 });
  await voice.start();
  stt.say("Old session.", [A("Old session.")]);
  await flush();
  await voice.stop();
  await voice.start();
  mock.timers.tick(500);
  await flush();
  assert.deepEqual(requests, []);
  assert.equal(voice.speakers.length, 0);
  await voice.stop();
});

test("a reconnect starts speaker labels over and tells the agent", async () => {
  const { voice, stt, requests, context } = setup();
  await voice.start();
  stt.say("Hi. Hey.");
  stt.diarize([A("Hi."), B("Hey.")]);
  await flush();
  voice.nameSpeaker("Speaker B", "Dan");
  assert.equal(voice.speakers.length, 2);

  stt.reconnect();
  assert.equal(voice.speakers.length, 0);
  assert.match(context(), /speaker labels start over/);

  // "speaker_1" in the new session is not known to be Dan.
  stt.say("Back again.");
  stt.diarize([B("Back again.")]);
  await flush();
  assert.equal(requests[1], "[Speaker A] Back again.");
  await voice.stop();
});

test("a failed start leaves no speaker subscription or context provider behind", async () => {
  const { voice, stt, providers } = setup({ label: "always" });
  let subscribed = 0;
  const subscribe = stt.speakers.subscribe;
  (stt.speakers as { subscribe: typeof subscribe }).subscribe = (l) => {
    subscribed += 1;
    const off = subscribe(l);
    return () => {
      subscribed -= 1;
      off();
    };
  };
  stt.connect = async () => {
    throw new Error("token endpoint down");
  };
  await assert.rejects(voice.start(), /token endpoint down/);
  assert.equal(providers.length, 0);
  assert.equal(subscribed, 0);
  // Nor its listeners on the adapter: a retry would otherwise run every
  // utterance through both sets and send it to the agent twice.
  for (const event of ["partial", "final", "error"] as const) assert.equal(stt.listenerCount(event), 0, event);
});

test("a start that fails and is retried sends each utterance once", async () => {
  const { voice, stt, requests } = setup(false);
  const connect = stt.connect.bind(stt);
  stt.connect = async () => {
    throw new Error("token endpoint down");
  };
  await assert.rejects(voice.start(), /token endpoint down/);
  stt.connect = connect;
  await voice.start();
  stt.say("One flat white.");
  await flush();
  assert.deepEqual(requests, ["One flat white."]);
  await voice.stop();
});

test("labels that arrive after a reconnect are not applied to the new session", async () => {
  const { voice, stt, requests } = setup({ label: "always", waitMs: 200 });
  await voice.start();
  // The utterance waits for settled labels; the connection restarts meanwhile.
  stt.say("Hi there.", [A("Hi there.")]);
  await flush();
  stt.reconnect();
  mock.timers.tick(200);
  await flush();
  // The old session's speaker ids do not label anyone now.
  assert.equal(voice.speakers.length, 0);
  assert.deepEqual(requests, ["Hi there."]);
  await voice.stop();
});

test("the keepalive defaults on when the adapter labels speakers", async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const stt = new FakeSTT();
  let sent = 0;
  stt.sendAudio = () => {
    sent += 1;
  };
  const frames = new EventEmitter<{ chunk: [Int16Array]; error: [Error] }>();
  const audio: AudioIO = {
    createCapture: () =>
      Object.assign(frames, { init: async () => {}, destroy: async () => {} }) as never,
    createPlayer: () => ({
      async init() {},
      enqueue() {},
      onDrained(cb: () => void) {
        cb();
      },
      stop() {},
      async destroy() {},
    }),
  };
  const glove = {
    displayManager: { resolverStore: new Map(), clearStack: async () => {} },
    addSubscriber() {},
    removeSubscriber() {},
    addContextProvider: () => () => {},
    async processRequest() {
      return {};
    },
  };
  // Default turn mode ("vad") with the built-in VAD, so the speech gate exists.
  const voice = new GloveVoice(glove as never, { stt, createTTS: () => new FakeTTS(), audio });
  await voice.start();
  const quiet = new Int16Array(320);
  frames.emit("chunk", quiet);
  assert.equal(sent, 0);
  mock.timers.tick(8000);
  frames.emit("chunk", quiet);
  assert.equal(sent, 1);
  await voice.stop();
});
