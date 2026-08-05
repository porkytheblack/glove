// The Anam passthrough adapter runs the shared avatar conformance suite
// against fakes for both halves of the wire: HTTP (session-token mint) and
// the command courier (passthrough audio input lives on the browser SDK, so
// the courier is a required config seam — the Tavus adapter's pattern).

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAvatarConformance, type AvatarConformanceContext } from "../src/conformance";
import { AnamPassthroughAdapter, type AnamClientCommand } from "../src/anam-passthrough";

const PCM_24K = { sampleRate: 24_000, channels: 1 as const, encoding: "pcm_s16le" as const };

interface AnamContext extends AvatarConformanceContext {
  commands: AnamClientCommand[];
  http: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
}

function anamContext(): AnamContext {
  const commands: AnamClientCommand[] = [];
  const http: AnamContext["http"] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    http.push({
      url: u,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    if (u.endsWith("/v1/auth/session-token")) {
      return new Response(JSON.stringify({ sessionToken: "sess_test" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const adapter = new AnamPassthroughAdapter({
    apiKey: "test-key",
    avatarId: "avatar_1",
    chunkMs: 10_000, // force buffering so endUtterance/interrupt do the flushing
    fetchFn,
    sendCommand: (cmd) => void commands.push(cmd),
  });
  return {
    adapter,
    commands,
    http,
    // Courier commands ARE the utterance traffic; HTTP is session setup.
    outbound: () => commands,
    settle: () => new Promise((r) => setTimeout(r, 5)),
  };
}

test("AnamPassthroughAdapter passes the avatar conformance suite", async () => {
  const results = await runAvatarConformance(anamContext);
  const failed = results.filter((r) => !r.passed);
  assert.equal(failed.length, 0, `\n${failed.map((f) => f.error).join("\n\n")}`);
  assert.ok(results.length >= 6, `only ${results.length} cases ran`);
});

test("sendCommand is required — the browser SDK is the only audio input", () => {
  assert.throws(
    () =>
      new AnamPassthroughAdapter({
        apiKey: "k",
        avatarId: "a",
      } as never),
    /sendCommand/,
  );
});

test("session token bakes in audio passthrough; the view is the sdk-session token", async () => {
  const ctx = anamContext();
  await ctx.adapter.connect();
  const mint = ctx.http.find((h) => h.url.endsWith("/v1/auth/session-token"));
  assert.ok(mint, "no session-token mint");
  assert.equal(mint.headers.Authorization, "Bearer test-key");
  const persona = (mint.body as { personaConfig: Record<string, unknown> }).personaConfig;
  assert.equal(persona.enableAudioPassthrough, true, "without the flag Anam runs its OWN LLM+TTS");
  assert.equal(persona.avatarId, "avatar_1");
  assert.ok(persona.avatarModel, "no avatarModel — passthrough docs target a specific generation");
  assert.deepEqual(ctx.adapter.view, {
    kind: "sdk-session",
    sessionToken: "sess_test",
    provider: "anam",
  });
});

test("audio buffers to 16k base64 chunks; end_sequence closes the utterance", async () => {
  const ctx = anamContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(Int16Array.from([1, 2, 3, 4]), PCM_24K);
  ctx.adapter.sendAudio(Int16Array.from([5, 6]), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();

  const chunks = ctx.commands.filter((c) => c.type === "audio_chunk");
  assert.equal(chunks.length, 1, "buffered chunks should flush as one command under chunkMs");
  assert.ok((chunks[0] as { audio: string }).audio.length > 0, "no audio payload");
  assert.equal(ctx.commands[ctx.commands.length - 1].type, "end_sequence");
});

test("non-16k audio is resampled to Anam's passthrough rate before framing", async () => {
  const ctx = anamContext();
  await ctx.adapter.connect();

  const oneSecond24k = new Int16Array(24_000);
  ctx.adapter.sendAudio(oneSecond24k, PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();

  const chunk = ctx.commands.find((c) => c.type === "audio_chunk") as { audio: string };
  const bytes = Math.ceil((chunk.audio.length * 3) / 4);
  const samples = Math.floor(bytes / 2);
  assert.ok(Math.abs(samples - 16_000) < 10, `expected ~16000 samples after resample, got ${samples}`);
});

test("interrupt drops the buffered tail and frames a bare interrupt command", async () => {
  const ctx = anamContext();
  await ctx.adapter.connect();

  ctx.adapter.sendAudio(new Int16Array(2_400), PCM_24K);
  ctx.adapter.interrupt();
  await ctx.settle();

  const types = ctx.commands.map((c) => c.type);
  assert.ok(types.includes("interrupt"), "no interrupt command");
  assert.ok(!types.includes("audio_chunk"), "the cut sentence's audio still went out");

  // The next utterance flushes fresh.
  ctx.adapter.sendAudio(new Int16Array(240), PCM_24K);
  ctx.adapter.endUtterance();
  await ctx.settle();
  assert.ok(
    ctx.commands.some((c) => c.type === "audio_chunk"),
    "post-interrupt utterance never flushed",
  );
});

test("disconnect stops claiming a live session (no server-side end exists)", async () => {
  const ctx = anamContext();
  await ctx.adapter.connect();
  assert.ok(ctx.adapter.isConnected);
  await ctx.adapter.disconnect();
  assert.ok(!ctx.adapter.isConnected);
  assert.equal(ctx.adapter.view, null, "a dead session must not keep offering its token");
});
