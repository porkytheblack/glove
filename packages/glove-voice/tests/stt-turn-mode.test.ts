import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "eventemitter3";
import { GloveVoice, type GloveVoiceConfig, type TurnMode } from "../src/voice";
import { ElevenLabsSTTAdapter } from "../src/adapters/eleven-labs/stt";
import type {
  AudioIO,
  STTAdapter,
  STTAdapterEvents,
  VADAdapterEvents,
  TTSAdapterEvents,
} from "../src/adapters/types";

console.debug = () => {};

// ─── Fakes ─────────────────────────────────────────────────────────────────

class FakeSTT extends EventEmitter<STTAdapterEvents> {
  sent = 0;
  flushes = 0;
  currentPartial = "";
  isConnected = true;
  constructor(public detectsTurns = true) {
    super();
  }
  async connect() {}
  sendAudio() {
    this.sent++;
  }
  flushUtterance() {
    this.flushes++;
  }
  disconnect() {}
  /** The provider ends the turn on its own. */
  commit(text: string) {
    this.currentPartial = "";
    this.emit("final", text);
  }
}

class FakeVAD extends EventEmitter<VADAdapterEvents> {
  isSpeaking = false;
  constructor(readonly supportsRealStart = false) {
    super();
  }
  process() {}
  /** Like the real VADs: clears the speaking state without emitting speech_end. */
  reset() {
    this.isSpeaking = false;
  }
  start() {
    this.isSpeaking = true;
    this.emit("speech_start");
  }
  /** Confirming VADs only: the tentative start was real speech. */
  confirm() {
    this.emit("speech_real_start");
  }
  /** Confirming VADs only: the tentative start was noise. */
  misfire() {
    this.isSpeaking = false;
    this.emit("vad_misfire");
  }
  end() {
    this.isSpeaking = false;
    this.emit("speech_end");
  }
}

class FakeCapture extends EventEmitter<{ chunk: [Int16Array]; error: [Error] }> {
  async init() {}
  async destroy() {}
  frame() {
    this.emit("chunk", new Int16Array(320));
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

function setup<S extends STTAdapter = FakeSTT>(
  turnMode: TurnMode,
  stt: S = new FakeSTT() as unknown as S,
  vad = new FakeVAD(),
  extra: Partial<GloveVoiceConfig> = {},
) {
  const capture = new FakeCapture();
  const audio: AudioIO = {
    createCapture: () => capture,
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
  const glove = {
    displayManager: { resolverStore: new Map(), clearStack: async () => {} },
    addSubscriber() {},
    removeSubscriber() {},
    async processRequest(text: string) {
      requests.push(text);
      return {};
    },
  };
  const voice = new GloveVoice(glove as never, {
    stt,
    createTTS: () => new FakeTTS(),
    turnMode,
    vad,
    audio,
    ...extra,
  });
  return { voice, stt, vad, capture, requests };
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

// ─── turnMode "stt" ────────────────────────────────────────────────────────

test('turnMode "stt" refuses an adapter that cannot detect turns', async () => {
  const { voice } = setup("stt", new FakeSTT(false));
  await assert.rejects(voice.start(), /detectsTurns/);
});

test("the provider ends the turn; the local VAD never commits", async () => {
  const { voice, stt, vad, capture, requests } = setup("stt");
  await voice.start();

  capture.frame(); // before speech: held back as pre-roll
  assert.equal(stt.sent, 0);

  vad.start();
  capture.frame();
  vad.end();
  capture.frame(); // after the pause: still streaming so the provider can judge
  assert.equal(stt.flushes, 0);
  assert.ok(stt.sent >= 2);

  stt.commit("Book a table for two.");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(requests, ["Book a table for two."]);

  // Committed while the VAD is quiet: the gate closes, audio stops.
  const sent = stt.sent;
  capture.frame();
  assert.equal(stt.sent, sent);

  mock.timers.tick(10_000);
  assert.equal(stt.flushes, 0);
  await voice.stop();
});

test("falls back to committing when the provider stays silent", async () => {
  const { voice, stt, vad, capture } = setup("stt");
  await voice.start();
  vad.start();
  capture.frame();
  stt.currentPartial = "and then";
  vad.end();

  mock.timers.tick(2499);
  assert.equal(stt.flushes, 0);
  mock.timers.tick(1);
  assert.equal(stt.flushes, 1);

  // The gate closed with the fallback commit.
  const sent = stt.sent;
  capture.frame();
  assert.equal(stt.sent, sent);
  await voice.stop();
});

test("a speaker who resumes cancels the fallback", async () => {
  const { voice, stt, vad, capture } = setup("stt");
  await voice.start();
  vad.start();
  capture.frame();
  vad.end();
  mock.timers.tick(1000);
  vad.start(); // "...um, actually"
  mock.timers.tick(5000);
  assert.equal(stt.flushes, 0);
  await voice.stop();
});

test("a commit while the VAD still hears speech closes the gate and needs no fallback", async () => {
  const { voice, stt, vad, capture, requests } = setup("stt");
  await voice.start();
  vad.start();
  capture.frame();
  const sent = stt.sent;
  stt.commit("Yes."); // Scribe predicts the turn end before the VAD's silence window
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(requests, ["Yes."]);

  // The turn interrupts, which resets the VAD without a speech_end. The gate
  // must already be closed, or silence would stream to STT from here on.
  assert.equal(vad.isSpeaking, false);
  capture.frame();
  capture.frame();
  assert.equal(stt.sent, sent);
  mock.timers.tick(10_000);
  assert.equal(stt.flushes, 0);

  // If the speaker carries on, a new segment opens the gate again with its pre-roll.
  vad.start();
  capture.frame();
  assert.ok(stt.sent > sent);
  await voice.stop();
});

test("a noise burst after speech end does not lose the fallback", async () => {
  const { voice, stt, vad, capture } = setup("stt", new FakeSTT(), new FakeVAD(true));
  await voice.start();
  vad.start();
  vad.confirm();
  capture.frame();
  stt.currentPartial = "and then";
  vad.end(); // fallback armed

  mock.timers.tick(1000);
  vad.start(); // tentative: a door slams
  mock.timers.tick(2000);
  assert.equal(stt.flushes, 0); // paused while the VAD makes up its mind
  vad.misfire(); // it was noise
  mock.timers.tick(2499);
  assert.equal(stt.flushes, 0);
  mock.timers.tick(1);
  assert.equal(stt.flushes, 1); // the utterance is still committed
  await voice.stop();
});

test("confirmed speech after a pause drops the fallback", async () => {
  const { voice, stt, vad, capture } = setup("stt", new FakeSTT(), new FakeVAD(true));
  await voice.start();
  vad.start();
  vad.confirm();
  capture.frame();
  vad.end();
  vad.start();
  vad.confirm(); // the speaker really did resume
  mock.timers.tick(10_000);
  assert.equal(stt.flushes, 0);
  await voice.stop();
});

test("a late commit for one utterance does not strand the next", async () => {
  const { voice, stt, vad, capture, requests } = setup("stt");
  await voice.start();
  // A and B are said close together; the VAD hears the end of B.
  vad.start();
  capture.frame();
  vad.end(); // fallback armed for what has been said so far

  // A's commit lands late. It starts A's turn, cancels the fallback and
  // closes the gate, but B is still uncommitted at the provider.
  stt.commit("First thing.");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(requests, ["First thing."]);
  mock.timers.tick(10_000);
  assert.equal(stt.flushes, 0);

  // The provider reports B's words while nobody is speaking: commit them.
  stt.currentPartial = "and the second thing";
  stt.emit("partial", "and the second thing");
  mock.timers.tick(2499);
  assert.equal(stt.flushes, 0);
  mock.timers.tick(1);
  assert.equal(stt.flushes, 1);
  await voice.stop();
});

test("with the Scribe adapter, a late commit leaves the next utterance committable without a new partial", async () => {
  // A socket that records what the adapter sends and lets the test play Scribe.
  class Socket {
    static OPEN = 1;
    static last: Socket | null = null;
    readyState = 0;
    sent: Record<string, unknown>[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      Socket.last = this;
      queueMicrotask(() => {
        this.readyState = Socket.OPEN;
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
  const g = globalThis as unknown as { WebSocket: unknown };
  const realSocket = g.WebSocket;
  g.WebSocket = Socket;
  try {
    const scribe = new ElevenLabsSTTAdapter({
      getToken: async () => "tok",
      commitStrategy: "turn_prediction",
      maxReconnects: 0,
    });
    const { voice, vad, capture, requests } = setup("stt", scribe);
    await voice.start();
    const ws = Socket.last!;
    const commits = () => ws.sent.filter((m) => m.commit === true).length;

    // A and B are said close together; Scribe has heard both.
    vad.start();
    capture.frame();
    ws.receive({ message_type: "partial_transcript", text: "first thing and the second thing" });
    vad.end(); // fallback armed

    // A's commit lands late and cancels the fallback. Scribe sends nothing
    // more: no partial for B, no commit for B.
    ws.receive({ message_type: "committed_transcript", text: "First thing." });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(requests, ["First thing."]);
    assert.equal(commits(), 0);

    // B is committed by the fallback all the same.
    mock.timers.tick(2499);
    assert.equal(commits(), 0);
    mock.timers.tick(1);
    assert.equal(commits(), 1);
    ws.receive({ message_type: "committed_transcript", text: "And the second thing." });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(requests, ["First thing.", "And the second thing."]);
    await voice.stop();
  } finally {
    g.WebSocket = realSocket;
  }
});

test("partials while the speaker is talking do not arm the fallback", async () => {
  const { voice, stt, vad, capture } = setup("stt");
  await voice.start();
  vad.start();
  capture.frame();
  stt.currentPartial = "still talking";
  stt.emit("partial", "still talking");
  mock.timers.tick(10_000);
  assert.equal(stt.flushes, 0);
  await voice.stop();
});

// ─── turnMode "vad" is unchanged ──────────────────────────────────────────

test('turnMode "vad" still commits on the local VAD', async () => {
  const { voice, stt, vad, capture } = setup("vad");
  await voice.start();
  vad.start();
  capture.frame();
  vad.end();
  assert.equal(stt.flushes, 1);
  await voice.stop();
});

test('turnMode "manual" warns when the adapter ends turns itself', async () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (msg: string) => warnings.push(msg);
  try {
    const { voice } = setup("manual", new FakeSTT(true));
    await voice.start();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /push-to-talk/);
    await voice.stop();
  } finally {
    console.warn = realWarn;
  }
});

// ─── Keeping an idle STT session open ──────────────────────────────────────

test("sttKeepAliveMs sends one mic frame through a closed gate at each interval", async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { voice, stt, vad, capture } = setup("vad", new FakeSTT(false), new FakeVAD(), {
    sttKeepAliveMs: 5000,
  });
  await voice.start();

  capture.frame();
  assert.equal(stt.sent, 0); // gated, and the interval has not passed
  mock.timers.tick(5000);
  capture.frame();
  assert.equal(stt.sent, 1); // one frame of room tone
  capture.frame();
  assert.equal(stt.sent, 1); // not every frame
  mock.timers.tick(5000);
  capture.frame();
  assert.equal(stt.sent, 2);

  // Real speech resets the clock.
  vad.start();
  capture.frame();
  vad.end();
  const sent = stt.sent;
  mock.timers.tick(4999);
  capture.frame();
  assert.equal(stt.sent, sent);
  await voice.stop();
});

test("no keepalive frames by default without a speaker source", async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { voice, stt, capture } = setup("vad", new FakeSTT(false));
  await voice.start();
  mock.timers.tick(60_000);
  capture.frame();
  assert.equal(stt.sent, 0);
  await voice.stop();
});
