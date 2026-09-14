import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { config } from "dotenv";
import { createAdapter, type SubscriberAdapter, type SubscriberEvent } from "glove-core";
import { inspectMp4Metadata } from "glove-video";
import { sampledVideoReviewModel } from "./sampled-video-review";
import { createVideoStudio } from "./studio";

config({ quiet: true });

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Set OPENROUTER_API_KEY before auditing videos.");
}
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const paths = process.argv
  .slice(2)
  .filter((value) => !value.startsWith("--"))
  .map((value) => resolve(invocationDirectory, value));
if (paths.length === 0) {
  throw new Error("Pass one or more local MP4 paths. Set VIDEO_BRIEF to the intended result.");
}
const brief = process.env.VIDEO_BRIEF?.trim();
if (!brief) throw new Error("Set VIDEO_BRIEF so the agent can judge the supplied videos against their intent.");

let deliveredAsset: string | undefined;
const captureDelivery: SubscriberAdapter = {
  async record(event, data) {
    if (event === "model_response") {
      const value = data as Extract<SubscriberEvent, { type: "model_response" }>;
      if (value.tool_calls?.length) {
        console.error(`director requested: ${value.tool_calls.map((call) => call.tool_name).join(", ")}`);
      }
    }
    if (event === "tool_use") {
      const value = data as Extract<SubscriberEvent, { type: "tool_use" }>;
      if (value.name.startsWith("glove_video_")) console.error(`running: ${value.name}`);
    }
    if (event === "tool_use_result") {
      const value = data as Extract<SubscriberEvent, { type: "tool_use_result" }>;
      if (value.tool_name === "glove_video_deliver" && value.result.status === "success") {
        deliveredAsset = (value.result.data as { id?: string } | null)?.id;
      }
    }
  },
};

const studio = await createVideoStudio({
  stream: false,
  subscribers: [captureDelivery],
  reviewPassingScore: 82,
  auditOnly: true,
  maxVideoOperations: 1,
  reviewModel: sampledVideoReviewModel(createAdapter({
    provider: "openrouter",
    model: process.env.VIDEO_REVIEW_MODEL?.trim() || "qwen/qwen3.5-flash-02-23",
    stream: false,
  })),
});

const candidates: Array<{ id: string; path: string }> = [];
for (const path of paths) {
  const bytes = new Uint8Array(await readFile(path));
  const metadata = inspectMp4Metadata(bytes);
  const asset = await studio.videoAssets.put(bytes, {
    name: basename(path),
    mime: "video/mp4",
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    duration: metadata.duration ?? 0,
    has_audio: metadata.has_audio,
    source: "imported",
    tags: ["audit-candidate"],
  });
  candidates.push({ id: asset.id, path });
}

await studio.agent.processRequest([
  `The intended result is: ${brief}`,
  `The provided candidate videos are: ${candidates.map((candidate) => candidate.id).join(", ")}.`,
  "Watch and critically review every candidate with glove_video_review, passing the full intended result as the brief.",
  "Compare the evidence and call glove_video_deliver once for the strongest passing candidate.",
  "If none pass, do not deliver one and explain what must change. Do not judge from metadata or filenames.",
].join(" "));

const reviews = await studio.videoReviews.list();
const reviewedAssets = new Set(reviews.map((review) => review.asset));
for (const candidate of candidates) {
  if (!reviewedAssets.has(candidate.id)) {
    throw new Error(`The agent failed to inspect candidate ${candidate.id} (${candidate.path}).`);
  }
}
if (deliveredAsset && !reviews.some((review) => review.asset === deliveredAsset && review.decision === "pass")) {
  throw new Error(`The agent attempted to deliver ${deliveredAsset} without a passing review.`);
}

console.log(JSON.stringify({ brief, candidates, delivered_asset: deliveredAsset, reviews }, null, 2));
