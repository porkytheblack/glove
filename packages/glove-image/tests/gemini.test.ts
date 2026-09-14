import assert from "node:assert/strict";
import test from "node:test";
import { geminiImages } from "../src/gemini/index";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");

test("Gemini adapter maps prompt, reference images, size, and usage", async () => {
  let requestBody: Record<string, any> | undefined;
  const adapter = geminiImages({
    apiKey: "test-key",
    model: "gemini-test-image",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [
          { text: "revised art direction" },
          { inlineData: { mimeType: "image/png", data: PNG.toString("base64") } },
        ] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await adapter.generate({
    prompt: "Make the launch key art",
    refs: [{ asset: "brand", role: "style", bytes: PNG, mime: "image/png" }],
    size: "1600x900",
  });

  assert.equal(requestBody?.contents[0].parts[0].text.includes("visual language"), true);
  assert.equal(requestBody?.contents[0].parts[1].inlineData.data, PNG.toString("base64"));
  assert.equal(requestBody?.generationConfig.imageConfig.aspectRatio, "16:9");
  assert.equal(result.images.length, 1);
  assert.equal(result.usage?.tokens_in, 12);
  assert.equal(result.revised_prompt, "revised art direction");
});

test("Gemini adapter ignores thinking images and reports provider errors", async () => {
  const adapter = geminiImages({
    apiKey: "test-key",
    fetch: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }],
    }), { status: 200 }),
  });
  await assert.rejects(
    () => adapter.generate({ prompt: "x", refs: [] }),
    /returned no final image/,
  );
});
