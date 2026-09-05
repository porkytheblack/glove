import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createAdapter, type SubscriberAdapter, type SubscriberEvent } from "glove-core";
import { inspectMp4Metadata, openrouterVideo } from "glove-video";
import { sampledVideoReviewModel } from "./sampled-video-review";
import { createVideoStudio } from "./studio";

config({ quiet: true });

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Set OPENROUTER_API_KEY before generating the video gallery.");
}

const generationBudgetUsd = 4;
const priorSpendUsd = Number.parseFloat(process.env.GALLERY_PRIOR_SPEND_USD ?? "0");
const requestedVideoOperations = Number.parseInt(
  process.env.GALLERY_MAX_VIDEO_OPERATIONS ?? "5",
  10,
);
const maxVideoOperations = Math.min(
  5,
  Math.max(1, Number.isFinite(requestedVideoOperations) ? requestedVideoOperations : 5),
);
const creativeDirection = process.env.GALLERY_CREATIVE_DIRECTION?.trim();
const directorModelName = process.env.GALLERY_DIRECTOR_MODEL?.trim();
const reviewModelName = process.env.GALLERY_REVIEW_MODEL?.trim() || "qwen/qwen3.5-flash-02-23";
const outputDirectory = fileURLToPath(new URL("./out/gallery/", import.meta.url));
const siteVideoDirectory = fileURLToPath(
  new URL("../../packages/site/public/video-gallery/", import.meta.url),
);
const siteDataPath = fileURLToPath(
  new URL("../../packages/site/lib/video-gallery-data.ts", import.meta.url),
);
await mkdir(outputDirectory, { recursive: true });
await mkdir(siteVideoDirectory, { recursive: true });

let deliveredAsset: string | undefined;
const toolSequence: string[] = [];
const seenToolCalls = new Set<string>();
const toolErrors: Array<{ tool: string; message: string }> = [];
const providerJobs: string[] = [];
const capture: SubscriberAdapter = {
  async record(event, data) {
    if (event === "tool_use") {
      const value = data as Extract<SubscriberEvent, { type: "tool_use" }>;
      if (!seenToolCalls.has(value.id) && (value.name.startsWith("glove_image_") || value.name.startsWith("glove_video_"))) {
        seenToolCalls.add(value.id);
        toolSequence.push(value.name);
      }
    }
    if (event === "model_response" || event === "model_response_complete") {
      const value = data as Extract<SubscriberEvent, { type: "model_response" }>;
      for (const call of value.tool_calls ?? []) {
        const callId = call.id ?? `${call.tool_name}:${toolSequence.length}`;
        if (!seenToolCalls.has(callId) && (call.tool_name.startsWith("glove_image_") || call.tool_name.startsWith("glove_video_"))) {
          seenToolCalls.add(callId);
          toolSequence.push(call.tool_name);
        }
      }
    }
    if (event === "tool_use_result") {
      const value = data as Extract<SubscriberEvent, { type: "tool_use_result" }>;
      if (value.tool_name === "glove_video_deliver" && value.result.status === "success") {
        deliveredAsset = (value.result.data as { id?: string } | null)?.id;
      }
      if (value.result.status === "error") {
        const message = value.result.message ?? String(value.result.data ?? "Unknown tool error");
        toolErrors.push({ tool: value.tool_name, message });
        console.warn(`${value.tool_name}: ${message}`);
      }
    }
  },
};

const progress = new Map<string, string>();
const studio = await createVideoStudio({
  stream: false,
  subscribers: [capture],
  maxVideoOperations,
  reviewPassingScore: 84,
  ...(directorModelName
    ? {
        directorModel: createAdapter({
          provider: "openrouter",
          model: directorModelName,
          stream: false,
        }),
      }
    : {}),
  reviewModel: sampledVideoReviewModel(createAdapter({
    provider: "openrouter",
    model: reviewModelName,
    stream: false,
  })),
  videoAdapter: openrouterVideo({
    pollIntervalMs: 10_000,
    maxPollAttempts: 90,
    title: "glove-video gallery case study",
  }),
  onVideoProgress(event) {
    const id = event.provider_job_id ?? "pending";
    if (event.provider_job_id && !providerJobs.includes(event.provider_job_id)) {
      providerJobs.push(event.provider_job_id);
    }
    const state = `${event.phase}:${Math.round((event.progress ?? 0) * 100)}`;
    if (progress.get(id) !== state) {
      progress.set(id, state);
      console.log(`video ${id}: ${event.phase} ${Math.round((event.progress ?? 0) * 100)}%`);
    }
  },
});

const brief = [
  "Create a worked video-generation case study that makes developers understand why glove-video is more valuable than a single generate_video(prompt) tool.",
  "Choose the subject yourself, but optimize for a beautiful and reliable six-second result: one non-human subject, one simple readable transformation or natural phenomenon, one coherent macro or tabletop shot, and no cuts.",
  "Do not use a paper airplane, hummingbird, person, animal, typography, logo, or action that depends on complex flight or anatomy.",
  "The final must be 16:9 and 720p, with a clean first second, a memorable middle action, and a settled final frame that can loop or hold on a product site. Audio is optional: prefer silence when sound would add synchronization risk.",
  "Treat this as a real workflow. Save matching recurring-subject and setting definitions in both the video and image libraries before generating. Create and inspect an opening keyframe with glove-image at exactly 1536x864, then use it as a first-frame reference.",
  "Use explicit timed beats. Watch every generated clip with glove_video_review. Use the evidence and revision_prompt to regenerate failures. Call glove_video_deliver exactly once, and only for the strongest candidate whose latest review passes 84.",
  `You have a hard allowance of ${maxVideoOperations} video operations and a hard total spend ceiling of $${generationBudgetUsd.toFixed(2)}. Every video must be exactly six seconds; stop before the allowance rather than exceeding it.`,
  "The gallery will expose the recorded recipes, review scores, rejected drafts, delivery gate, and spend. Make the process itself worth showing.",
  ...(creativeDirection
    ? [`Evidence from an earlier run requires this pivot: ${creativeDirection}`]
    : []),
].join(" ");

await studio.agent.processRequest(brief);

for (let turn = 0; turn < 3 && !deliveredAsset && studio.videoOperations.used() < maxVideoOperations; turn += 1) {
  const reviews = await studio.videoReviews.list();
  const strongest = [...reviews].sort((a, b) => b.score - a.score)[0];
  const remaining = maxVideoOperations - studio.videoOperations.used();
  await studio.agent.processRequest([
    `No candidate has been delivered yet. ${remaining} video operation${remaining === 1 ? " remains" : "s remain"}.`,
    strongest
      ? `The strongest review so far is ${strongest.score}/100 for ${strongest.asset}. Use its concrete evidence and revision_prompt.`
      : "There is no completed review yet; inspect every existing video draft before generating again.",
    "Continue autonomously. Reuse the strongest recipe and opening frame, generate at most one revision at a time, watch it, and deliver it only if it passes. Do not change to a more complex concept.",
  ].join(" "));
}

const images = await studio.imageAssets.list();
const videos = await studio.videoAssets.list();
const reviews = await studio.videoReviews.list();
const reviewByAsset = new Map(reviews.map((review) => [review.asset, review]));

const keyframes = [];
for (let index = 0; index < images.length; index += 1) {
  const image = images[index]!;
  const extension = image.mime === "image/jpeg" ? "jpg" : extname(image.name ?? "")?.slice(1) || "png";
  const file = `keyframe-${index + 1}.${extension}`;
  const bytes = await studio.imageAssets.bytes(image.id);
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  keyframes.push({
    id: image.id,
    file,
    width: image.width,
    height: image.height,
    intent: image.recipe?.intent ?? image.name ?? "Opening keyframe",
    finalPrompt: image.recipe?.finalPrompt ?? "",
    trace: image.recipe?.trace ?? [],
    costUsd: image.recipe?.usage?.cost_usd ?? 0,
  });
}

const attempts = [];
for (let index = 0; index < videos.length; index += 1) {
  const video = videos[index]!;
  const file = `attempt-${index + 1}.mp4`;
  const bytes = await studio.videoAssets.bytes(video.id);
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  const metadata = inspectMp4Metadata(bytes);
  const review = reviewByAsset.get(video.id);
  attempts.push({
    id: video.id,
    file,
    title: deliveredAsset === video.id ? "Delivered cut" : `Draft ${index + 1}`,
    width: metadata.width ?? video.width,
    height: metadata.height ?? video.height,
    duration: metadata.duration ?? video.duration,
    hasAudio: metadata.has_audio ?? video.has_audio ?? false,
    source: video.source,
    parent: video.recipe?.parent,
    intent: video.recipe?.intent ?? "",
    finalPrompt: video.recipe?.finalPrompt ?? "",
    beats: video.recipe?.beats ?? [],
    trace: video.recipe?.trace ?? [],
    refs: video.recipe?.refs ?? [],
    costUsd: video.recipe?.usage?.cost_usd ?? 0,
    delivered: deliveredAsset === video.id,
    review: review
      ? {
          decision: review.decision,
          score: review.score,
          summary: review.summary,
          strengths: review.strengths,
          issues: review.issues,
          revisionPrompt: review.revision_prompt,
          reviewer: review.reviewer,
          costUsd: review.usage?.cost_usd ?? 0,
        }
      : null,
  });
}

const characters = await studio.videoLibrary.listCharacters();
const scenes = await studio.videoLibrary.listScenes();
const imageUsage = studio.imageUsage.report();
const videoUsage = studio.videoUsage.report();
const trackedCostUsd =
  priorSpendUsd + (imageUsage.total.cost_usd ?? 0) + (videoUsage.total.cost_usd ?? 0);

const result = {
  status: deliveredAsset ? "delivered" : "no-passing-candidate",
  brief,
  generationBudgetUsd,
  trackedCostUsd,
  videoOperations: { used: studio.videoOperations.used(), max: maxVideoOperations },
  deliveredAsset: deliveredAsset ?? null,
  keyframes,
  attempts,
  characters,
  scenes,
  toolSequence,
  toolErrors,
  providerJobs,
  usage: { image: imageUsage, video: videoUsage },
};

if (trackedCostUsd > generationBudgetUsd) {
  throw new Error(`Tracked spend $${trackedCostUsd.toFixed(4)} exceeded the $${generationBudgetUsd.toFixed(2)} ceiling.`);
}

const dataSource = [
  "// GENERATED by examples/video-studio/gallery.ts — do not edit by hand.",
  "// The videos, recipes, review evidence, and spend below came from one agentic run.",
  `export const videoGallery = ${JSON.stringify(result, null, 2)} as const;`,
  "",
].join("\n");
await writeFile(siteDataPath, dataSource);
await writeFile(join(outputDirectory, "result.json"), JSON.stringify(result, null, 2));

if (!deliveredAsset) {
  throw new Error(
    `No candidate passed after ${studio.videoOperations.used()} video operations. Drafts and reviews were preserved in ${outputDirectory}.`,
  );
}

console.log(JSON.stringify({
  status: result.status,
  deliveredAsset,
  attempts: attempts.length,
  trackedCostUsd,
  videoOperations: result.videoOperations,
  siteDataPath,
}, null, 2));
