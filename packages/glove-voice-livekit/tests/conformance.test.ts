// Both LiveKit avatar adapters run the shared avatar conformance suite from
// glove-voice-avatar against fakes for both halves of the wire: HTTP (the
// provider handshake) and the AvatarWire (the room's byte-stream/RPC leg).
// Passing proves the mapping code; only a live room proves the provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAvatarConformance, type AvatarConformanceContext } from "glove-voice-avatar";
import {
  AnamLiveKitAvatar,
  AUDIO_STREAM_TOPIC,
  RPC_CLEAR_BUFFER,
  RPC_PLAYBACK_FINISHED,
  TavusLiveKitAvatar,
  type AvatarWire,
} from "../src";

const PCM_24K = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };

type WireEvent =
  | { kind: "stream_open"; attrs: Record<string, number> }
  | { kind: "write"; bytes: number }
  | { kind: "close" }
  | { kind: "rpc"; method: string; payload: string };

class FakeWire implements AvatarWire {
  events: WireEvent[] = [];
  handlers = new Map<string, (payload: string) => Promise<string> | string>();

  async openAudioStream(attrs: { sampleRate: number; channels: number }) {
    this.events.push({ kind: "stream_open", attrs: { ...attrs } });
    return {
      write: async (bytes: Uint8Array) => {
        this.events.push({ kind: "write", bytes: bytes.byteLength });
      },
      close: async () => {
        this.events.push({ kind: "close" });
      },
    };
  }

  async performRpc(method: string, payload = ""): Promise<string> {
    this.events.push({ kind: "rpc", method, payload });
    return "";
  }

  onRpc(method: string, handler: (payload: string) => Promise<string> | string): void {
    this.handlers.set(method, handler);
  }
}

interface LiveKitContext extends AvatarConformanceContext {
  wire: FakeWire;
  http: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }>;
}

function fakeFetch(
  http: LiveKitContext["http"],
  routes: Record<string, (body: unknown) => unknown>,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    http.push({ url: u, method, body, headers: (init?.headers as Record<string, string>) ?? {} });
    for (const [suffix, respond] of Object.entries(routes)) {
      const [m, path] = suffix.split(" ");
      if (method === m && u.endsWith(path)) {
        return new Response(JSON.stringify(respond(body)), { status: 200 });
      }
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

function tavusContext(): LiveKitContext {
  const wire = new FakeWire();
  const http: LiveKitContext["http"] = [];
  const adapter = new TavusLiveKitAvatar({
    apiKey: "test-key",
    faceId: "face_1",
    palId: "pal_lk",
    livekitUrl: "wss://lk.example",
    avatarToken: "jwt-avatar",
    wire,
    fetchFn: fakeFetch(http, {
      "POST /v2/conversations": () => ({ conversation_id: "c_lk" }),
    }),
  });
  return {
    adapter,
    wire,
    http,
    outbound: () => wire.events,
    settle: () => new Promise((r) => setTimeout(r, 5)),
  };
}

function anamContext(): LiveKitContext {
  const wire = new FakeWire();
  const http: LiveKitContext["http"] = [];
  const adapter = new AnamLiveKitAvatar({
    apiKey: "test-key",
    avatarId: "avatar_1",
    livekitUrl: "wss://lk.example",
    avatarToken: "jwt-avatar",
    wire,
    fetchFn: fakeFetch(http, {
      "POST /v1/auth/session-token": () => ({ sessionToken: "sess_tok" }),
      "POST /v1/engine/session": () => ({ sessionId: "eng_1" }),
    }),
  });
  return {
    adapter,
    wire,
    http,
    outbound: () => wire.events,
    settle: () => new Promise((r) => setTimeout(r, 5)),
  };
}

for (const [name, make] of [
  ["TavusLiveKitAvatar", tavusContext],
  ["AnamLiveKitAvatar", anamContext],
] as const) {
  test(`${name} passes the avatar conformance suite`, async () => {
    const results = await runAvatarConformance(make);
    const failed = results.filter((r) => !r.passed);
    assert.equal(failed.length, 0, `\n${failed.map((f) => f.error).join("\n\n")}`);
    assert.ok(results.length >= 6, `only ${results.length} cases ran`);
  });
}

test("Tavus conversation is pointed at OUR LiveKit room", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  const create = ctx.http.find((h) => h.url.endsWith("/v2/conversations"));
  assert.ok(create, "no conversation create");
  const body = create.body as Record<string, unknown>;
  assert.equal(body.pal_id, "pal_lk");
  assert.equal(body.face_id, "face_1");
  assert.equal(body.custom_greeting, "", "absent greeting = Tavus speaks a stock one in its own voice");
  assert.deepEqual(body.properties, {
    livekit_ws_url: "wss://lk.example",
    livekit_room_token: "jwt-avatar",
  });
  assert.deepEqual(ctx.adapter.view, {
    kind: "webrtc-room",
    url: "wss://lk.example",
    provider: "tavus-livekit",
  });
});

test("Anam handshake: persona marks the brain as ours, engine call uses the session token", async () => {
  const ctx = anamContext();
  await ctx.adapter.connect();
  const token = ctx.http.find((h) => h.url.endsWith("/v1/auth/session-token"));
  assert.ok(token, "no session-token call");
  const body = token.body as { personaConfig: Record<string, unknown>; environment: Record<string, unknown> };
  assert.equal(body.personaConfig.llmId, "CUSTOMER_CLIENT_V1", "Anam must not run its own LLM");
  assert.equal(body.personaConfig.avatarId, "avatar_1");
  assert.deepEqual(body.environment, { livekitUrl: "wss://lk.example", livekitToken: "jwt-avatar" });
  const engine = ctx.http.find((h) => h.url.endsWith("/v1/engine/session"));
  assert.ok(engine, "engine session never started — the avatar never joins the room");
  assert.equal(engine.headers.Authorization, "Bearer sess_tok");
});

test("audio streams under the protocol topic attrs, one stream per utterance", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(new Int16Array(2_400), PCM_24K);
  ctx.adapter.sendAudio(new Int16Array(1_200), PCM_24K);
  ctx.adapter.endUtterance();
  ctx.adapter.sendAudio(new Int16Array(600), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();

  const opens = ctx.wire.events.filter((e) => e.kind === "stream_open");
  assert.equal(opens.length, 2, "each utterance is one byte stream");
  assert.deepEqual(opens[0], { kind: "stream_open", attrs: { sampleRate: 24_000, channels: 1 } });
  const writes = ctx.wire.events.filter((e) => e.kind === "write");
  assert.equal(writes.length, 3);
  assert.equal((writes[0] as { bytes: number }).bytes, 4_800, "s16le bytes = samples * 2");
  assert.equal(ctx.wire.events.filter((e) => e.kind === "close").length, 2, "endUtterance closes = flushes");
});

test("non-24k agent audio is resampled before framing", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  ctx.adapter.sendAudio(new Int16Array(16_000), { sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" });
  ctx.adapter.endUtterance();
  await ctx.settle();
  const write = ctx.wire.events.find((e) => e.kind === "write") as { bytes: number };
  assert.ok(Math.abs(write.bytes / 2 - 24_000) < 10, `expected ~24000 samples, got ${write.bytes / 2}`);
});

test("interrupt abandons the stream and fires lk.clear_buffer", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  ctx.adapter.sendAudio(new Int16Array(2_400), PCM_24K);
  ctx.adapter.interrupt();
  await ctx.settle();
  const kinds = ctx.wire.events.map((e) => e.kind);
  assert.ok(kinds.includes("close"), "the cut utterance's stream was never closed");
  const rpc = ctx.wire.events.find((e) => e.kind === "rpc") as { method: string };
  assert.equal(rpc?.method, RPC_CLEAR_BUFFER);

  // The next utterance opens a FRESH stream.
  ctx.adapter.sendAudio(new Int16Array(240), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();
  assert.equal(ctx.wire.events.filter((e) => e.kind === "stream_open").length, 2);
});

test("worker's playback_finished RPC surfaces as utterance_done (unless interrupted)", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  let done = 0;
  ctx.adapter.on("utterance_done", () => done++);
  const handler = ctx.wire.handlers.get(RPC_PLAYBACK_FINISHED);
  assert.ok(handler, "no playback_finished handler registered");
  await handler(JSON.stringify({ playback_position: 1.2, interrupted: false }));
  await handler(JSON.stringify({ playback_position: 0.3, interrupted: true }));
  assert.equal(done, 1, "interrupted playback must not read as a clean finish");
});

test("disconnect ends the Tavus conversation", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  await ctx.adapter.disconnect();
  assert.ok(
    ctx.http.some((h) => h.url.includes("/v2/conversations/c_lk/end")),
    "the conversation (and the meter) were left running",
  );
});

test("topic constant matches LiveKit Agents' datastream protocol", () => {
  assert.equal(AUDIO_STREAM_TOPIC, "lk.audio_stream");
});
