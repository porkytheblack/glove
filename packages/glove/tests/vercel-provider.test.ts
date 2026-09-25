import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { applyOpenAICacheControl } from "../src/models/openai-compat";
import { createAdapter, providers, resolveProviderApiKey } from "../src/models/providers";
import { resolvePromptCache } from "../src/core";

const ENV_KEYS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function completionResponse(): Response {
  return new Response(
    JSON.stringify({
      id: "c1",
      object: "chat.completion",
      created: 1,
      model: "anthropic/claude-sonnet-4",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("vercel AI Gateway provider", () => {
  it("is registered as an OpenAI-compatible gateway", () => {
    const def = providers.vercel;
    assert.ok(def);
    assert.equal(def.format, "openai");
    assert.equal(def.baseURL, "https://ai-gateway.vercel.sh/v1");
    assert.equal(def.envVar, "AI_GATEWAY_API_KEY");
  });

  it("reads AI_GATEWAY_API_KEY, then falls back to VERCEL_OIDC_TOKEN", () => {
    clearEnv();
    assert.equal(resolveProviderApiKey(providers.vercel), undefined);
    process.env.VERCEL_OIDC_TOKEN = "oidc";
    assert.equal(resolveProviderApiKey(providers.vercel), "oidc");
    process.env.AI_GATEWAY_API_KEY = "key";
    assert.equal(resolveProviderApiKey(providers.vercel), "key");
  });

  it("throws a helpful error when no credential is set", () => {
    clearEnv();
    assert.throws(() => createAdapter({ provider: "vercel" }), /AI_GATEWAY_API_KEY/);
  });

  it("sends requests to the gateway with the gateway key", async () => {
    clearEnv();
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; auth: string | null; body: any }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push({ url: req.url, auth: req.headers.get("authorization"), body: await req.json() });
      return completionResponse();
    }) as typeof fetch;
    try {
      const adapter = createAdapter({ provider: "vercel", stream: false, cache: true });
      adapter.setSystemPrompt("be brief");
      const result = await adapter.prompt(
        { messages: [{ sender: "user", text: "hello" }] },
        async () => undefined,
      );
      assert.equal(result.messages[0]?.text, "hi");
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.url, "https://ai-gateway.vercel.sh/v1/chat/completions");
      assert.equal(seen[0]!.auth, "Bearer oidc-token");
      assert.equal(seen[0]!.body.model, "anthropic/claude-sonnet-4");
      // Message-level cache breakpoints on the system prompt and latest user turn.
      const [system, user] = seen[0]!.body.messages;
      assert.deepEqual(system.cache_control, { type: "ephemeral", ttl: "5m" });
      assert.equal(system.content, "be brief");
      assert.deepEqual(user.cache_control, { type: "ephemeral", ttl: "5m" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("applyOpenAICacheControl placement", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "hello" },
  ];

  it("keeps OpenRouter breakpoints on the last content part", () => {
    const out = applyOpenAICacheControl(messages, resolvePromptCache(true), "openrouter") as any[];
    assert.deepEqual(out[0].content, [
      { type: "text", text: "sys", cache_control: { type: "ephemeral", ttl: "5m" } },
    ]);
    assert.equal(out[0].cache_control, undefined);
  });

  it("puts Vercel breakpoints on the message and leaves content alone", () => {
    const out = applyOpenAICacheControl(messages, resolvePromptCache({ ttl: "1h" }), "vercel") as any[];
    assert.equal(out[1].content, "hello");
    assert.deepEqual(out[1].cache_control, { type: "ephemeral", ttl: "1h" });
  });

  it("is a no-op for providers that cache automatically", () => {
    const out = applyOpenAICacheControl(messages, resolvePromptCache(true), "openai");
    assert.equal(out, messages);
  });
});
