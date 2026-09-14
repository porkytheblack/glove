import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "../src/core";
import {
  formatMessages,
  OpenAICompatAdapter,
} from "../src/models/openai-compat";
import { createAdapter } from "../src/models/providers";

const signature = { google: { thought_signature: "opaque-signature" } };

function streamResponse(): Response {
  const chunks = [
    {
      id: "completion-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "gemini-test",
      choices: [{
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [{
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "inspect_capabilities", arguments: "{}" },
            extra_content: signature,
          }],
        },
        finish_reason: "tool_calls",
      }],
    },
    {
      id: "completion-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "gemini-test",
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  ];
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAI-compatible provider state", () => {
  it("round-trips Gemini thought signatures on their original function call", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => streamResponse();
    try {
      const adapter = new OpenAICompatAdapter({
        apiKey: "test-key",
        baseURL: "https://provider.test/v1",
        model: "gemini-test",
        provider: "gemini",
        stream: true,
      });
      const result = await adapter.prompt(
        { messages: [{ sender: "user", text: "Inspect." }] },
        async () => undefined,
      );
      const response = result.messages[0]!;
      assert.deepEqual(response.tool_calls?.[0]?.provider_options, {
        gemini: { extra_content: signature },
      });

      const history: Message[] = [
        { sender: "user", text: "Inspect." },
        response,
        {
          sender: "user",
          text: "",
          tool_results: [{
            call_id: "call-1",
            tool_name: "inspect_capabilities",
            result: { status: "success", data: { ready: true } },
          }],
        },
      ];
      const geminiMessages = formatMessages(history, false, "gemini") as Array<Record<string, unknown>>;
      const toolCalls = geminiMessages[1]?.tool_calls as Array<Record<string, unknown>>;
      assert.deepEqual(toolCalls[0]?.extra_content, signature);

      const fallbackMessages = formatMessages(history, false, "openrouter") as Array<Record<string, unknown>>;
      const fallbackCalls = fallbackMessages[1]?.tool_calls as Array<Record<string, unknown>>;
      assert.equal("extra_content" in fallbackCalls[0]!, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("provider endpoint overrides", () => {
  it("passes a custom Anthropic-wire base URL through the unified factory", async () => {
    const originalFetch = globalThis.fetch;
    let requested = "";
    globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({
        id: "message-1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ready" }],
        model: "claude-compatible",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const adapter = createAdapter({
        provider: "anthropic",
        apiKey: "host-owned-test-key",
        baseURL: "https://anthropic-compatible.test",
        model: "claude-compatible",
        stream: false,
      });
      const result = await adapter.prompt(
        { messages: [{ sender: "user", text: "Inspect." }] },
        async () => undefined,
      );
      assert.equal(result.messages[0]?.text, "ready");
      assert.equal(requested, "https://anthropic-compatible.test/v1/messages");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
