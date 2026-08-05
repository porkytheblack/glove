// The Tavus echo adapter runs the shared avatar conformance suite against a
// fake HTTP layer — every outbound frame is captured, none reach a provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAvatarConformance, type AvatarConformanceContext } from "../src/conformance";
import { TavusEchoAdapter } from "../src/tavus-echo";

const PCM_24K = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };

function tavusContext(): AvatarConformanceContext & { sent: Array<{ url: string; body: unknown }> } {
  const sent: Array<{ url: string; body: unknown }> = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    sent.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
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
    personaId: "p_echo",
    chunkMs: 10_000, // force buffering so endUtterance/interrupt do the flushing
    fetchFn,
  });
  return {
    adapter,
    sent,
    // The conversation-create call is session setup, not utterance traffic —
    // conformance counts what flows AFTER connect.
    outbound: () => sent.filter((s) => !s.url.endsWith("/v2/conversations")),
    settle: () => new Promise((r) => setTimeout(r, 5)),
  };
}

test("TavusEchoAdapter passes the avatar conformance suite", async () => {
  const results = await runAvatarConformance(tavusContext);
  const failed = results.filter((r) => !r.passed);
  assert.equal(failed.length, 0, `\n${failed.map((f) => f.error).join("\n\n")}`);
  assert.ok(results.length >= 6, `only ${results.length} cases ran`);
});

test("echo frames carry base64 24k audio under a stable inference id, done on endUtterance", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(Int16Array.from([1, 2, 3, 4]), PCM_24K);
  ctx.adapter.sendAudio(Int16Array.from([5, 6]), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();

  const echoes = ctx.sent.filter((s) => (s.body as any)?.event_type === "conversation.echo");
  assert.equal(echoes.length, 1, "buffered chunks should flush as one frame under chunkMs");
  const props = (echoes[0].body as any).properties;
  assert.equal(props.sample_rate, 24_000);
  assert.equal(props.done, true);
  assert.equal(props.modality, "audio");
  assert.ok(props.inference_id, "no inference id");
  assert.ok(props.audio.length > 0, "no audio payload");
});

test("interrupt drops the buffered tail and frames conversation.interrupt", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(new Int16Array(2_400), PCM_24K);
  ctx.adapter.interrupt();
  await ctx.settle();

  const kinds = ctx.sent.map((s) => (s.body as any)?.event_type).filter(Boolean);
  assert.ok(kinds.includes("conversation.interrupt"), "no interrupt frame");
  assert.ok(!kinds.includes("conversation.echo"), "the cut sentence's audio still went out");

  // The next utterance gets a FRESH inference id.
  ctx.adapter.sendAudio(new Int16Array(240), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();
  const echo = ctx.sent.find((s) => (s.body as any)?.event_type === "conversation.echo") as any;
  assert.ok(echo, "post-interrupt utterance never flushed");
});

test("non-24k audio is resampled before framing", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();

  // 16k input (Gemini-out would be 24k, but the contract allows any rate).
  const oneSecond16k = new Int16Array(16_000);
  ctx.adapter.sendAudio(oneSecond16k, { sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" });
  ctx.adapter.endUtterance();
  await ctx.settle();

  const echo = ctx.sent.find((s) => (s.body as any)?.event_type === "conversation.echo") as any;
  const bytes = Math.ceil((echo.body.properties.audio.length * 3) / 4);
  const samples = Math.floor(bytes / 2);
  assert.ok(Math.abs(samples - 24_000) < 10, `expected ~24000 samples after resample, got ${samples}`);
});

test("disconnect ends the conversation", async () => {
  const ctx = tavusContext();
  await ctx.adapter.connect();
  await ctx.adapter.disconnect();
  assert.ok(
    ctx.sent.some((s) => s.url.includes("/v2/conversations/c_test/end")),
    "the Daily room (and the meter) were left running",
  );
});
