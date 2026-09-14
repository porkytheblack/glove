import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMessages } from "../src/models/openai-compat";

const multimodalMessage = {
  sender: "user" as const,
  text: "Review this clip",
  content: [
    { type: "text" as const, text: "Review this clip" },
    {
      type: "video" as const,
      source: {
        type: "base64" as const,
        media_type: "video/mp4",
        data: "AAEC",
      },
    },
  ],
};

test("OpenRouter formats Glove video content as video_url", () => {
  const [message] = formatMessages([multimodalMessage], false, "openrouter");
  assert.equal(message?.role, "user");
  const content = (message as { content: Array<Record<string, unknown>> }).content;
  assert.deepEqual(content[1], {
    type: "video_url",
    video_url: { url: "data:video/mp4;base64,AAEC" },
  });
});

test("non-OpenRouter compatibility formatting remains unchanged", () => {
  const [message] = formatMessages([multimodalMessage]);
  const content = (message as { content: Array<Record<string, unknown>> }).content;
  assert.deepEqual(content[1], {
    type: "image_url",
    image_url: { url: "data:video/mp4;base64,AAEC" },
  });
});

test("OpenRouter video blocks survive adjacent runtime context without changing the input", () => {
  const original = structuredClone(multimodalMessage);
  const [message] = formatMessages([multimodalMessage, { sender: "user", text: "Goals: inspect clip", framework_context: "runtime" }], false, "openrouter");
  const content = (message as { content: Array<Record<string, unknown>> }).content;
  assert.deepEqual(content[1], { type: "video_url", video_url: { url: "data:video/mp4;base64,AAEC" } });
  assert.deepEqual(content[2], { type: "text", text: "Goals: inspect clip" });
  assert.deepEqual(multimodalMessage, original);
});
