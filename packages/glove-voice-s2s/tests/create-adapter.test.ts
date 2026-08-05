// createS2SAdapter mirrors glove-core's createAdapter: explicit args first,
// environment second, clear errors at CONSTRUCTION when neither supplies a
// credential — not a 401 at connect().

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createS2SAdapter } from "../src/create-adapter";
import { GeminiLiveAdapter, type WebSocketLike } from "../src/gemini-live";
import { OpenAIRealtimeSocketAdapter } from "../src/openai-realtime-socket";

const S2S_ENV = ["S2S_PROVIDER", "S2S_MODEL", "S2S_TURN_DETECTION", "OPENAI_API_KEY", "GEMINI_API_KEY"];

beforeEach(() => {
  for (const k of S2S_ENV) delete process.env[k];
});

class NullSocket implements WebSocketLike {
  readyState = 1;
  constructor(readonly url: string) {}
  send() {}
  close() {}
  addEventListener(type: string, fn: (ev: unknown) => void) {
    if (type === "open") queueMicrotask(() => fn({}));
  }
}

test("provider defaults from whichever key is set — OpenAI first", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  assert.ok(createS2SAdapter() instanceof OpenAIRealtimeSocketAdapter);

  delete process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = "ai-test";
  assert.ok(createS2SAdapter() instanceof GeminiLiveAdapter);
});

test("S2S_PROVIDER wins over key-presence ordering", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.GEMINI_API_KEY = "ai-test";
  process.env.S2S_PROVIDER = "gemini";
  assert.ok(createS2SAdapter() instanceof GeminiLiveAdapter);
});

test("no provider and no keys is a construction-time error", () => {
  assert.throws(() => createS2SAdapter(), /no provider/);
});

test("a named provider without its key is a construction-time error naming the env var", () => {
  assert.throws(() => createS2SAdapter({ provider: "gemini" }), /GEMINI_API_KEY/);
});

test("model resolves explicit → S2S_MODEL → provider default, onto the wire", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const urls: string[] = [];
  const factory = (url: string) => {
    urls.push(url);
    return new NullSocket(url);
  };

  process.env.S2S_MODEL = "gpt-realtime-2.1";
  await createS2SAdapter({ provider: "openai", socketFactory: factory }).connect();
  assert.match(urls[0], /model=gpt-realtime-2\.1/, "S2S_MODEL never reached the URL");

  await createS2SAdapter({
    provider: "openai",
    model: "gpt-realtime-mini",
    socketFactory: factory,
  }).connect();
  assert.match(urls[1], /model=gpt-realtime-mini/, "explicit model must beat S2S_MODEL");

  delete process.env.S2S_MODEL;
  await createS2SAdapter({ provider: "openai", socketFactory: factory }).connect();
  assert.match(urls[2], /model=gpt-realtime(?!-)/, "provider default missing");
});

test("apiKey argument wins over the env key", async () => {
  process.env.OPENAI_API_KEY = "sk-env";
  const urls: string[] = [];
  const adapter = createS2SAdapter({
    provider: "gemini",
    apiKey: "ai-explicit",
    socketFactory: (url: string) => {
      urls.push(url);
      return new NullSocket(url);
    },
  });
  process.env.GEMINI_API_KEY = "ai-env";
  await adapter.connect();
  assert.match(urls[0], /key=ai-explicit/);
});

test("voice resolves explicit → S2S_VOICE, and session config still wins", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.S2S_VOICE = "cedar";
  const sent: unknown[] = [];
  const socketFactory = (url: string) => {
    const s = new NullSocket(url);
    s.send = (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d)));
    return s;
  };

  // env voice lands in the session setup
  await createS2SAdapter({ provider: "openai", socketFactory }).connect({});
  assert.equal((sent[0] as any).session.audio.output.voice, "cedar");

  // explicit factory voice beats env
  sent.length = 0;
  await createS2SAdapter({ provider: "openai", voice: "marin", socketFactory }).connect({});
  assert.equal((sent[0] as any).session.audio.output.voice, "marin");

  // a voice named in the session config (RealtimeAgent's `voice`) beats both
  sent.length = 0;
  await createS2SAdapter({ provider: "openai", voice: "marin", socketFactory }).connect({
    voice: "alloy",
  });
  assert.equal((sent[0] as any).session.audio.output.voice, "alloy");
});

test("Gemini voice from the factory reaches the setup frame", async () => {
  process.env.GEMINI_API_KEY = "ai-test";
  const sent: unknown[] = [];
  const adapter = createS2SAdapter({
    provider: "gemini",
    voice: "Charon",
    socketFactory: (url: string) => {
      const s = new NullSocket(url);
      s.send = (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d)));
      return s;
    },
  });
  await adapter.connect({});
  const setup = (sent[0] as any).setup;
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Charon");
});

test("Gemini setup enables context compression by default; false opts out", async () => {
  process.env.GEMINI_API_KEY = "ai-test";
  const sent: unknown[] = [];
  const socketFactory = (url: string) => {
    const s = new NullSocket(url);
    s.send = (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d)));
    return s;
  };

  await createS2SAdapter({ provider: "gemini", socketFactory }).connect({});
  assert.ok(
    (sent[0] as any).setup.contextWindowCompression?.slidingWindow,
    "no compression — the session dies at the provider's 15-minute audio cap",
  );

  sent.length = 0;
  await createS2SAdapter({
    provider: "gemini",
    contextWindowCompression: false,
    socketFactory,
  }).connect({});
  assert.equal((sent[0] as any).setup.contextWindowCompression, undefined);
});

test("Gemini realtimeInput knobs reach the setup frame verbatim", async () => {
  process.env.GEMINI_API_KEY = "ai-test";
  const sent: unknown[] = [];
  const adapter = createS2SAdapter({
    provider: "gemini",
    realtimeInput: {
      activityHandling: "NO_INTERRUPTION",
      automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW" },
    },
    socketFactory: (url: string) => {
      const s = new NullSocket(url);
      s.send = (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d)));
      return s;
    },
  });
  await adapter.connect({});
  const cfg = (sent[0] as any).setup.realtimeInputConfig;
  assert.equal(cfg.activityHandling, "NO_INTERRUPTION");
  assert.equal(cfg.automaticActivityDetection.endOfSpeechSensitivity, "END_SENSITIVITY_LOW");
});

test("OpenAI truncation config reaches the session setup", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const sent: unknown[] = [];
  const adapter = createS2SAdapter({
    provider: "openai",
    truncation: { type: "retention_ratio", retention_ratio: 0.8 },
    socketFactory: (url: string) => {
      const s = new NullSocket(url);
      s.send = (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d)));
      return s;
    },
  });
  await adapter.connect({});
  assert.deepEqual((sent[0] as any).session.truncation, {
    type: "retention_ratio",
    retention_ratio: 0.8,
  });
});

test("S2S_TURN_DETECTION shapes the OpenAI session setup", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.S2S_TURN_DETECTION = "server_vad";
  const sent: unknown[] = [];
  const adapter = createS2SAdapter({
    provider: "openai",
    socketFactory: (url: string) => {
      const s = new NullSocket(url);
      s.send = (d: string | ArrayBufferLike) => void sent.push(JSON.parse(String(d)));
      return s;
    },
  });
  await adapter.connect({});
  const update = sent[0] as { session?: { audio?: { input?: { turn_detection?: { type?: string } } } } };
  assert.equal(update.session?.audio?.input?.turn_detection?.type, "server_vad");
});
