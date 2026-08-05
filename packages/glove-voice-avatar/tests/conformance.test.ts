// The Tavus echo adapter runs the shared avatar conformance suite against
// fakes for both halves of the wire: HTTP (conversation create/end) and the
// interaction courier (Tavus interactions travel only over the Daily data
// channel, so the courier is a required config seam).

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAvatarConformance, type AvatarConformanceContext } from "../src/conformance";
import { TavusEchoAdapter } from "../src/tavus-echo";

const PCM_24K = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };

interface TavusContext extends AvatarConformanceContext {
  interactions: Array<Record<string, unknown>>;
  http: Array<{ url: string; body: unknown }>;
}

function tavusContext(): TavusContext {
  const interactions: Array<Record<string, unknown>> = [];
  const http: Array<{ url: string; body: unknown }> = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    http.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith("/v2/conversations")) {
      return new Response(
        JSON.stringify({ conversation_id: "c_test", conversation_url: "https://tavus.daily.co/c_test" }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const adapter = new TavusEchoAdapter({
    apiKey: "test-key",
    palId: "pal_echo",
    faceId: "face_1",
    chunkMs: 10_000, // force buffering so endUtterance/interrupt do the flushing
    fetchFn,
    sendInteraction: (event) => void interactions.push(event),
  });
  return {
    adapter,
    interactions,
    http,
    // Interaction events ARE the utterance traffic; HTTP is session setup.
    outbound: () => interactions,
    settle: () => new Promise((r) => setTimeout(r, 5)),
  };
}

test("TavusEchoAdapter passes the avatar conformance suite", async () => {
  const results = await runAvatarConformance(tavusContext);
  const failed = results.filter((r) => !r.passed);
  assert.equal(failed.length, 0, `\n${failed.map((f) => f.error).join("\n\n")}`);
  assert.ok(results.length >= 6, `only ${results.length} cases ran`);
});

test("sendInteraction is required — data channel is the only interaction transport", () => {
  assert.throws(
    () =>
      new TavusEchoAdapter({
        apiKey: "k",
        palId: "p",
        faceId: "f",
      } as never),
    /sendInteraction/,
  );
});

test("conversation create carries pal_id + face_id; the view is the Daily room", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  const create = ctx.http.find((h) => h.url.endsWith("/v2/conversations")) as any;
  assert.equal(create.body.pal_id, "pal_echo");
  assert.equal(create.body.face_id, "face_1");
  assert.equal(
    create.body.custom_greeting,
    "",
    "an absent greeting makes Tavus speak a stock one in ITS OWN voice over our stream",
  );
  assert.deepEqual(ctx.adapter.view, {
    kind: "webrtc-room",
    url: "https://tavus.daily.co/c_test",
    provider: "tavus",
  });
});

test("echo frames carry base64 24k audio under a stable inference id, done on endUtterance", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(Int16Array.from([1, 2, 3, 4]), PCM_24K);
  ctx.adapter.sendAudio(Int16Array.from([5, 6]), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();

  const echoes = ctx.interactions.filter((e) => e.event_type === "conversation.echo");
  assert.equal(echoes.length, 1, "buffered chunks should flush as one frame under chunkMs");
  const props = (echoes[0] as any).properties;
  assert.equal(props.sample_rate, 24_000);
  assert.equal(props.done, true);
  assert.equal(props.modality, "audio");
  assert.ok(props.inference_id, "no inference id");
  assert.ok(props.audio.length > 0, "no audio payload");
  assert.equal((echoes[0] as any).message_type, "conversation");
  assert.equal((echoes[0] as any).conversation_id, "c_test");
});

test("interrupt drops the buffered tail and frames a bare conversation.interrupt", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(new Int16Array(2_400), PCM_24K);
  ctx.adapter.interrupt();
  await ctx.settle();

  const kinds = ctx.interactions.map((e) => e.event_type);
  assert.ok(kinds.includes("conversation.interrupt"), "no interrupt frame");
  assert.ok(!kinds.includes("conversation.echo"), "the cut sentence's audio still went out");
  const interrupt = ctx.interactions.find((e) => e.event_type === "conversation.interrupt") as any;
  assert.equal(interrupt.properties, undefined, "interrupt must carry NO properties object");
  assert.equal(interrupt.conversation_id, "c_test");

  // The next utterance gets a FRESH inference id.
  ctx.adapter.sendAudio(new Int16Array(240), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();
  assert.ok(
    ctx.interactions.some((e) => e.event_type === "conversation.echo"),
    "post-interrupt utterance never flushed",
  );
});

test("non-24k audio is resampled before framing", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  const oneSecond16k = new Int16Array(16_000);
  ctx.adapter.sendAudio(oneSecond16k, { sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" });
  ctx.adapter.endUtterance();
  await ctx.settle();

  const echo = ctx.interactions.find((e) => e.event_type === "conversation.echo") as any;
  const bytes = Math.ceil((echo.properties.audio.length * 3) / 4);
  const samples = Math.floor(bytes / 2);
  assert.ok(Math.abs(samples - 24_000) < 10, `expected ~24000 samples after resample, got ${samples}`);
});

test("without palId, connect ensures a minimal echo PAL (reused by name)", async () => {
  const http: Array<{ url: string; method: string; body: unknown }> = [];
  let palExists = false;
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    http.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith("/v2/pals") && method === "GET") {
      return new Response(
        JSON.stringify(palExists ? [{ pal_id: "pal_auto", pal_name: "glove-echo-pal" }] : []),
        { status: 200 },
      );
    }
    if (u.endsWith("/v2/pals") && method === "POST") {
      palExists = true;
      return new Response(JSON.stringify({ pal_id: "pal_auto" }), { status: 200 });
    }
    if (u.endsWith("/v2/conversations")) {
      return new Response(
        JSON.stringify({ conversation_id: "c_test", conversation_url: "https://tavus.daily.co/c_test" }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const make = () =>
    new TavusEchoAdapter({
      apiKey: "k",
      faceId: "face_1",
      fetchFn,
      sendInteraction: () => {},
    });

  await make().connect();
  const created = http.find((h) => h.url.endsWith("/v2/pals") && h.method === "POST") as any;
  assert.ok(created, "no minimal echo PAL was created");
  assert.equal(created.body.pipeline_mode, "echo");
  assert.equal(created.body.default_face_id, "face_1");
  assert.equal(created.body.custom_greeting, undefined, "the minimal PAL must carry NO extras");
  const convo = http.find((h) => h.url.endsWith("/v2/conversations")) as any;
  assert.equal(convo.body.pal_id, "pal_auto");

  // Second boot: reused by name, not recreated.
  http.length = 0;
  await make().connect();
  assert.ok(
    !http.some((h) => h.url.endsWith("/v2/pals") && h.method === "POST"),
    "a second boot should reuse the PAL by name, not accumulate PALs",
  );
});

test("disconnect ends the conversation", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  await ctx.adapter.disconnect();
  assert.ok(
    ctx.http.some((h) => h.url.includes("/v2/conversations/c_test/end")),
    "the Daily room (and the meter) were left running",
  );
});
