import assert from "node:assert/strict";
import { test } from "node:test";
import { openrouterVideo } from "../src/openrouter/index";
import type { VideoModelCapabilities } from "../src/core/index";

const capabilities: VideoModelCapabilities = {
  modes: ["text-to-video", "image-to-video"],
  maxRefs: 1,
  refRoles: ["first-frame"],
  durations: [1],
  aspectRatios: ["16:9"],
  resolutions: ["480p"],
  audio: false,
  negativePrompt: false,
  seed: false,
  maxCandidates: 1,
};

test("OpenRouter adapter submits, polls, downloads, reports usage, and maps frame images", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    Response.json({ id: "job_1", polling_url: "/api/v1/videos/job_1", status: "pending" }, { status: 202 }),
    Response.json({ id: "job_1", polling_url: "/api/v1/videos/job_1", status: "in_progress" }),
    Response.json({
      id: "job_1",
      status: "completed",
      unsigned_urls: ["https://cdn.example/clip.mp4"],
      usage: { cost: 0.052 },
    }),
    new Response(new Uint8Array([0, 1, 2, 3]), {
      headers: { "content-type": "video/mp4" },
    }),
  ];
  const fetchMock: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch");
    return response;
  };
  const adapter = openrouterVideo({
    apiKey: "test-key",
    model: "test/video-model",
    capabilities,
    pollIntervalMs: 0,
    fetch: fetchMock,
  });
  const progress: string[] = [];
  const result = await adapter.generate(
    {
      prompt: "A red paper airplane glides forward",
      refs: [
        {
          asset: "img_1",
          role: "first-frame",
          mime: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
        },
      ],
      params: { duration: 1, resolution: "480p", aspectRatio: "16:9", audio: false },
    },
    { onProgress: (event) => { progress.push(event.phase); } },
  );

  assert.equal(requests[0]!.url, "https://openrouter.ai/api/v1/videos");
  assert.equal(requests[1]!.url, "https://openrouter.ai/api/v1/videos/job_1");
  assert.equal(requests[2]!.url, "https://openrouter.ai/api/v1/videos/job_1");
  assert.equal(requests[3]!.url, "https://cdn.example/clip.mp4");
  const body = JSON.parse(String(requests[0]!.init?.body)) as {
    frame_images: Array<{ frame_type: string; image_url: { url: string } }>;
  };
  assert.equal(body.frame_images[0]!.frame_type, "first_frame");
  assert.match(body.frame_images[0]!.image_url.url, /^data:image\/png;base64,/);
  assert.equal((requests[0]!.init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.equal((requests[3]!.init?.headers as Record<string, string>).Authorization, undefined);
  assert.deepEqual(progress, ["queued", "queued", "generating", "downloading", "downloading"]);
  assert.deepEqual([...result.videos[0]!.bytes], [0, 1, 2, 3]);
  assert.equal(result.videos[0]!.width, undefined);
  assert.equal(result.videos[0]!.height, undefined);
  assert.deepEqual(result.provider_job_ids, ["job_1"]);
  assert.equal(result.usage?.cost_usd, 0.052);
  assert.equal(result.usage?.seconds_generated, 1);
});

test("OpenRouter adapter rejects unknown models without explicit capabilities", () => {
  assert.throws(
    () => openrouterVideo({ model: "future/video-model" }),
    /Pass capabilities.*GET \/api\/v1\/videos\/models/,
  );
});

test("OpenRouter adapter surfaces terminal job failures", async () => {
  const responses = [
    Response.json({ id: "job_bad", polling_url: "/api/v1/videos/job_bad", status: "pending" }, { status: 202 }),
    Response.json({ id: "job_bad", status: "failed", error: "provider rejected prompt" }),
  ];
  const adapter = openrouterVideo({
    apiKey: "test-key",
    model: "test/video-model",
    capabilities,
    pollIntervalMs: 0,
    fetch: async () => responses.shift()!,
  });
  await assert.rejects(
    adapter.generate({ prompt: "test", refs: [], params: { duration: 1 } }),
    /provider rejected prompt/,
  );
});
