import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "eventemitter3";
import { GloveVoice, type TurnMode } from "../src/voice";
import type {
  AudioIO,
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

function setup(turnMode: TurnMode, stt = new FakeSTT(), vad = new FakeVAD()) {
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
