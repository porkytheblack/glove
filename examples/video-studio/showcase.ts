import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import type { SubscriberAdapter, SubscriberEvent } from "glove-core";
import { inspectMp4Metadata, openrouterVideo } from "glove-video";
import { createVideoStudio } from "./studio";

config({ quiet: true });

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Set OPENROUTER_API_KEY before generating the showcase.");
}

const outputDirectory = new URL("./out/showcase/", import.meta.url).pathname;
await mkdir(outputDirectory, { recursive: true });

let deliveredAsset: string | undefined;
const captureDelivery: SubscriberAdapter = {
  async record(event, data) {
    if (event === "tool_use_result") {
      const value = data as Extract<SubscriberEvent, { type: "tool_use_result" }>;
      if (value.tool_name === "glove_video_deliver" && value.result.status === "success") {
        deliveredAsset = (value.result.data as { id?: string } | null)?.id;
      }
    }
  },
};

const progress = new Map<string, string>();
const configuredOperations = Number.parseInt(process.env.MAX_VIDEO_OPERATIONS ?? "3", 10);
const maxVideoOperations = Number.isFinite(configuredOperations)
  ? Math.min(3, Math.max(1, configuredOperations))
  : 3;
const studio = await createVideoStudio({
  stream: false,
  subscribers: [captureDelivery],
  videoAdapter: openrouterVideo({
    pollIntervalMs: 10_000,
    maxPollAttempts: 90,
    title: "glove-video agentic showcase",
  }),
  reviewPassingScore: 82,
  maxVideoOperations,
  onVideoProgress(event) {
    const id = event.provider_job_id ?? "pending";
    const status = `${event.phase}:${Math.round((event.progress ?? 0) * 100)}`;
    if (progress.get(id) !== status) {
      progress.set(id, status);
      console.log(`video ${id}: ${event.phase} ${Math.round((event.progress ?? 0) * 100)}%`);
    }
  },
});

await studio.agent.processRequest([
  "Create one genuinely excellent, self-contained six-second cinematic site-hero video in 16:9 at 720p with synchronized sound.",
  "You choose the subject and creative direction. Favor one non-human subject performing one simple, memorable action in one coherent shot so the result is elegant rather than overambitious.",
  "Design it to work on a polished product site: immediate visual hook, uncluttered composition, room for interface copy outside the focal area, no embedded text or branding, and a clean ending.",
  "Develop the concept, generate and inspect its opening keyframe, animate it, then watch and critically review every video candidate.",
  "If the first video misses the brief or has distracting artifacts, revise it using the review feedback and inspect the new result.",
  `You have a hard allowance of ${maxVideoOperations} video operation${maxVideoOperations === 1 ? "" : "s"} in this run.`,
  "Do not expose a draft. Deliver exactly one strongest result only after it passes the configured quality gate.",
].join(" "));

const allReviews = await studio.videoReviews.list();
const usage = studio.videoUsage.report();
const budget = {
  ceiling_usd: 2,
  video_model: "google/veo-3.1-lite",
  video_cost_usd_per_second_720p_with_audio: 0.05,
  video_attempt_seconds: 6,
  max_video_operations: studio.videoOperations.max,
  used_video_operations: studio.videoOperations.used(),
  max_video_generation_spend_usd: studio.videoOperations.max * 6 * 0.05,
};

if (!deliveredAsset) {
  const result = {
    status: "no-passing-candidate",
    output: null,
    delivered_asset: null,
    all_reviews: allReviews,
    usage,
    budget,
  };
  await writeFile(`${outputDirectory}agentic-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 2;
} else {
  const finalAsset = await studio.videoAssets.get(deliveredAsset);
  if (!finalAsset) throw new Error(`Delivered video ${deliveredAsset} is missing from the asset store.`);
  const finalReview = await studio.videoReviews.latest(deliveredAsset);
  if (finalReview?.decision !== "pass") {
    throw new Error(`Delivered video ${deliveredAsset} has no passing review.`);
  }

  const videoBytes = await studio.videoAssets.bytes(deliveredAsset);
  const outputPath = `${outputDirectory}agentic-final.mp4`;
  await writeFile(outputPath, videoBytes);

  let keyframePath: string | undefined;
  const keyframeId = finalAsset.recipe?.refs?.find((ref) => ref.role === "first-frame")?.asset;
  if (keyframeId) {
    const keyframe = await studio.imageAssets.get(keyframeId);
    if (keyframe) {
      const extension = keyframe.mime === "image/jpeg" ? "jpg" : keyframe.mime === "image/webp" ? "webp" : "png";
      keyframePath = `${outputDirectory}agentic-keyframe.${extension}`;
      await writeFile(keyframePath, await studio.imageAssets.bytes(keyframeId));
    }
  }

  const result = {
    status: "delivered",
    output: outputPath,
    keyframe: keyframePath,
    delivered_asset: deliveredAsset,
    metadata: inspectMp4Metadata(videoBytes),
    review: finalReview,
    all_reviews: allReviews,
    usage,
    budget,
  };
  await writeFile(`${outputDirectory}agentic-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
