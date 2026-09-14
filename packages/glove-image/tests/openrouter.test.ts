import assert from "node:assert/strict";
import { test } from "node:test";
import { openrouterImages } from "../src/openrouter/index";

test("OpenRouter image adapter forwards the fitted size through image_config", async () => {
  let request: RequestInit | undefined;
  const adapter = openrouterImages({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      request = init;
      return Response.json({
        choices: [{
          message: {
            images: [{
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              },
            }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.04 },
      });
    },
  });

  const result = await adapter.generate({
    prompt: "Landscape opening frame",
    refs: [],
    size: "1536x864",
    candidates: 1,
  });

  const body = JSON.parse(String(request?.body)) as {
    image_config?: { size?: string };
  };
  assert.deepEqual(body.image_config, { aspect_ratio: "16:9", size: "1536x864" });
  assert.equal(result.images.length, 1);
  assert.equal(result.usage?.cost_usd, 0.04);
});

test("OpenRouter image adapter merges extra image_config while keeping fitted size authoritative", async () => {
  let request: RequestInit | undefined;
  const adapter = openrouterImages({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      request = init;
      return Response.json({
        choices: [{
          message: {
            images: [{
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              },
            }],
          },
        }],
      });
    },
  });

  await adapter.generate({
    prompt: "Landscape opening frame",
    refs: [],
    size: "1536x864",
    candidates: 1,
    extra: { image_config: { quality: "high", size: "1024x1024" } },
  });

  const body = JSON.parse(String(request?.body)) as {
    image_config?: { size?: string; quality?: string };
  };
  assert.deepEqual(body.image_config, {
    quality: "high",
    aspect_ratio: "16:9",
    size: "1536x864",
  });
});
