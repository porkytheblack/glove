import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, ModelAdapter } from "../src/core";
import { OpenAICompatAdapter } from "../src/models/openai-compat";
import { OpenRouterAdapter } from "../src/models/openrouter";
import { MimoAdapter } from "../src/models/mimo";

const image: Message = { sender: "user", text: "Inspect", content: [{ type: "text", text: "Inspect" }, { type: "image", source: { type: "url", url: "https://example.com/image.png", media_type: "image/png" } }] };
const context: Message = { sender: "user", text: "Goals: inspect image", framework_context: "runtime" };
const adapters: [string, () => ModelAdapter][] = [
  ["OpenAI-compatible", () => new OpenAICompatAdapter({ apiKey: "test", model: "test", stream: false })],
  ["OpenRouter", () => new OpenRouterAdapter({ apiKey: "test", model: "test", stream: false })],
  ["MiMo", () => new MimoAdapter({ apiKey: "test", model: "test", stream: false })],
];
for (const [name, make] of adapters) {
  test(`${name}: SDK request preserves media and original messages when merging framework context`, async () => {
    const adapter = make();
    let wire: { role: string; content: unknown }[] = [];
    // Intercept at the SDK boundary, after the real adapter formatter/cache transforms.
    (adapter as unknown as { client: unknown }).client = { chat: { completions: { create: async (params: { messages: typeof wire }) => {
      wire = params.messages;
      return { choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }], usage: {} };
    } } } };
    for (const messages of [[image, context], [context, image], [image, image, context]]) {
      const original = structuredClone(messages);
      await adapter.prompt({ messages }, async () => {});
      const content = wire[0].content;
      assert.ok(Array.isArray(content));
      assert.equal(content.filter(p => p.type === "image_url").length, messages.filter(m => m.content).length);
      assert.ok(content.some(p => p.type === "text" && p.text === context.text));
      assert.deepEqual(messages, original);
    }
    await adapter.prompt({ messages: [{ sender: "user", text: "Human" }, context] }, async () => {});
    assert.equal(wire[0].content, "Human\nGoals: inspect image");
  });
}
