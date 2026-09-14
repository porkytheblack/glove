import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createAdapter, type SubscriberAdapter, type SubscriberEvent } from "glove-core";
import { inspectMp4Metadata, openrouterVideo, type VideoModelCapabilities } from "glove-video";
import { sampledVideoReviewModel } from "./sampled-video-review";
import { createVideoStudio } from "./studio";

config({ quiet: true });

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Set OPENROUTER_API_KEY before generating the brand gallery.");
}

const taskBudgetUsd = 10;
const priorTaskSpendUsd = Number.parseFloat(
  process.env.BRAND_PRIOR_TASK_SPEND_USD ?? "0",
);
const maxVideoOperations = 4;
const directorModelName = process.env.BRAND_DIRECTOR_MODEL?.trim() ||
  "qwen/qwen3.5-plus-20260420";
const reviewModelName = process.env.BRAND_REVIEW_MODEL?.trim() ||
  "qwen/qwen3.5-flash-02-23";
const videoModelName = process.env.BRAND_VIDEO_MODEL?.trim() ||
  "bytedance/seedance-2.0";
const outputDirectory = fileURLToPath(new URL("./out/brand-gallery/", import.meta.url));
const siteVideoDirectory = fileURLToPath(
  new URL("../../packages/site/public/video-gallery/", import.meta.url),
);
const siteDataPath = fileURLToPath(
  new URL("../../packages/site/lib/video-brand-gallery-data.ts", import.meta.url),
);
await mkdir(outputDirectory, { recursive: true });
await mkdir(siteVideoDirectory, { recursive: true });

const seedanceCapabilities: VideoModelCapabilities = {
  modes: ["text-to-video", "image-to-video"],
  maxRefs: 4,
  refRoles: ["first-frame", "last-frame", "identity", "style", "motion", "continuity"],
  durations: { min: 4, max: 15 },
  aspectRatios: ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"],
  resolutions: ["480p", "720p", "1080p", "4K"],
  audio: true,
  negativePrompt: false,
  seed: true,
  maxCandidates: 1,
};

let deliveredRun: string | undefined;
let deliveredAssets: string[] = [];
const toolSequence: string[] = [];
const toolErrors: Array<{ tool: string; message: string }> = [];
const providerJobs: string[] = [];
const seenCalls = new Set<string>();
const capture: SubscriberAdapter = {
  async record(event, data) {
    if (event === "model_response" || event === "model_response_complete") {
      const value = data as Extract<SubscriberEvent, { type: "model_response" }>;
      for (const call of value.tool_calls ?? []) {
        const id = call.id ?? `${call.tool_name}:${toolSequence.length}`;
        if (seenCalls.has(id)) continue;
        seenCalls.add(id);
        if (call.tool_name.startsWith("glove_image_") || call.tool_name.startsWith("glove_video_")) {
          toolSequence.push(call.tool_name);
          console.log(`agent: ${call.tool_name}`);
        }
      }
    }
    if (event === "tool_use_result") {
      const value = data as Extract<SubscriberEvent, { type: "tool_use_result" }>;
      if (value.result.status === "error") {
        const message = value.result.message ?? String(value.result.data ?? "Unknown tool error");
        toolErrors.push({ tool: value.tool_name, message });
        console.warn(`${value.tool_name}: ${message}`);
      }
      if (value.tool_name === "glove_video_flow_deliver" && value.result.status === "success") {
        const result = value.result.data as {
          run?: string;
          shots?: Array<{ asset?: { id?: string } }>;
        } | null;
        deliveredRun = result?.run;
        deliveredAssets = result?.shots?.flatMap((shot) => shot.asset?.id ? [shot.asset.id] : []) ?? [];
      }
    }
  },
};

const progress = new Map<string, string>();
const studio = await createVideoStudio({
  stream: false,
  subscribers: [capture],
  maxVideoOperations,
  reviewPassingScore: 82,
  directorModel: createAdapter({
    provider: "openrouter",
    model: directorModelName,
    stream: false,
  }),
  reviewModel: sampledVideoReviewModel(createAdapter({
    provider: "openrouter",
    model: reviewModelName,
    stream: false,
  })),
  videoAdapter: openrouterVideo({
    model: videoModelName,
    capabilities: seedanceCapabilities,
    pollIntervalMs: 10_000,
    maxPollAttempts: 120,
    title: "glove-video recurring brand model case study",
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
  "Create a complete fictional fashion-brand campaign that demonstrates why glove-video is an agent workflow rather than a one-shot video API.",
  "You own the art direction: invent the tasteful brand name, choose the adult human model, define one unmistakable hero garment and a restrained color system, and choose three visually distinct scenes that tell one coherent campaign story.",
  "The same non-celebrity adult model must appear recognizably in all three scenes. Preserve face shape, skin tone, hairstyle, build, and the hero garment. Avoid visible brand typography or generated logos; the campaign identity should come from styling, palette, and cinematography.",
  "First use glove-image to create a clean, photoreal identity reference for the model and garment. Create at most two supplemental angles using the strongest image as an identity reference. Inspect every reference with glove_image_describe and keep only a coherent set.",
  "Save the canonical model in both the image and video character libraries. Attach the same best-first image ids as identity references in the video character definition. Save three reusable video scene definitions.",
  "Save one three-shot flow and run it. Each shot must use that canonical character and one distinct saved scene. Use reference-to-video identity images, not first-frame conditioning, so the provider receives the recurring model references on every shot.",
  "Each shot must be exactly five seconds, 16:9, 720p, no generated audio, one continuous take, simple natural performance, controlled camera movement, and no cuts. Use 2–3 broad timed beats per shot.",
  "Shot roles: a controlled studio hero reveal, an architectural city movement shot, and a warm after-hours or destination portrait. Interpret these freely but make them feel like one premium launch film.",
  "After the flow completes, get its shot asset ids and call glove_video_review on every shot. The brief passed to each review must demand a direct match to the supplied identity references, stable adult anatomy, the exact hero garment, scene-specific action, coherent motion, no text or watermark, and no audio.",
  "If all three pass, call glove_video_flow_deliver exactly once. If one fails and a video operation remains, revise only that weakest shot from its revision_prompt, review the replacement, and deliver the flow using the replacements field. Never publish a failed or unreviewed shot.",
  `You have a hard limit of ${maxVideoOperations} video operations. The complete task, including earlier experiments, has a $${taskBudgetUsd.toFixed(2)} ceiling; prior reconciled task spend is $${priorTaskSpendUsd.toFixed(4)}. Prefer a coherent three-shot campaign over spending the remaining allowance.`,
  "Your final response should state the invented campaign concept, whether the sequence delivery gate passed, and the exact asset ids selected. Do not claim success if the gate held.",
].join(" ");

await studio.agent.processRequest(brief);

for (let turn = 0; turn < 2 && !deliveredRun; turn += 1) {
  const runs = await studio.videoFlows.listRuns();
  const run = runs.at(-1);
  const reviews = await studio.videoReviews.list();
  const remaining = maxVideoOperations - studio.videoOperations.used();
  await studio.agent.processRequest([
    "Finish the campaign without restarting it.",
    run
      ? `The latest flow run is ${run.id} with status ${run.status}. Its shot assets are ${run.shots.map((shot) => `${shot.shot}=${shot.assets.join("|") || "none"}`).join(", ")}.`
      : "No flow run was found; save and run the required three-shot flow now.",
    reviews.length
      ? `Recorded reviews: ${reviews.map((review) => `${review.asset}:${review.decision}:${review.score}`).join(", ")}.`
      : "No video reviews are recorded yet; review every completed shot before any delivery attempt.",
    `${remaining} video operation${remaining === 1 ? " remains" : "s remain"}. Revise at most the single weakest failed shot if possible.`,
    "Call glove_video_flow_deliver exactly once only when all selected shots have passing latest reviews; use replacements for any revised shot.",
  ].join(" "));
}

const images = await studio.imageAssets.list();
const videos = await studio.videoAssets.list();
const reviews = await studio.videoReviews.list();
const reviewByAsset = new Map(reviews.map((review) => [review.asset, review]));
const references = [];
for (let index = 0; index < images.length; index += 1) {
  const image = images[index]!;
  const extension = image.mime === "image/jpeg" ? "jpg" : extname(image.name ?? "")?.slice(1) || "png";
  const file = `brand-reference-${index + 1}.${extension}`;
  const bytes = await studio.imageAssets.bytes(image.id);
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  references.push({
    id: image.id,
    file,
    width: image.width,
    height: image.height,
    intent: image.recipe?.intent ?? image.name ?? "Campaign identity reference",
    finalPrompt: image.recipe?.finalPrompt ?? "",
    trace: image.recipe?.trace ?? [],
    costUsd: image.recipe?.usage?.cost_usd ?? 0,
  });
}

const attempts = [];
for (let index = 0; index < videos.length; index += 1) {
  const video = videos[index]!;
  const file = `brand-take-${index + 1}.mp4`;
  const bytes = await studio.videoAssets.bytes(video.id);
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  const metadata = inspectMp4Metadata(bytes);
  const review = reviewByAsset.get(video.id);
  attempts.push({
    id: video.id,
    file,
    shot: video.recipe?.flow?.shot ?? null,
    flowRun: video.recipe?.flow?.run ?? null,
    selected: deliveredAssets.includes(video.id),
    width: metadata.width ?? video.width,
    height: metadata.height ?? video.height,
    duration: metadata.duration ?? video.duration,
    hasAudio: metadata.has_audio ?? video.has_audio ?? false,
    source: video.source,
    parent: video.recipe?.parent ?? null,
    intent: video.recipe?.intent ?? "",
    finalPrompt: video.recipe?.finalPrompt ?? "",
    beats: video.recipe?.beats ?? [],
    trace: video.recipe?.trace ?? [],
    refs: video.recipe?.refs ?? [],
    costUsd: video.recipe?.usage?.cost_usd ?? 0,
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

const imageUsage = studio.imageUsage.report();
const videoUsage = studio.videoUsage.report();
const trackedRunCostUsd =
  (imageUsage.total.cost_usd ?? 0) + (videoUsage.total.cost_usd ?? 0);
const trackedTaskSpendUsd = priorTaskSpendUsd + trackedRunCostUsd;
const flowRuns = await studio.videoFlows.listRuns();
const result = {
  status: deliveredRun ? "delivered" : "gate-held",
  brief,
  taskBudgetUsd,
  priorTaskSpendUsd,
  trackedRunCostUsd,
  trackedTaskSpendUsd,
  models: {
    director: directorModelName,
    reviewer: reviewModelName,
    video: videoModelName,
    image: "google/gemini-2.5-flash-image",
  },
  videoOperations: { used: studio.videoOperations.used(), max: maxVideoOperations },
  deliveredRun: deliveredRun ?? null,
  deliveredAssets,
  references,
  attempts,
  characters: await studio.videoLibrary.listCharacters(),
  scenes: await studio.videoLibrary.listScenes(),
  flowRuns,
  toolSequence,
  toolErrors,
  providerJobs,
  usage: { image: imageUsage, video: videoUsage },
};

if (trackedTaskSpendUsd > taskBudgetUsd) {
  throw new Error(
    `Tracked task spend $${trackedTaskSpendUsd.toFixed(4)} exceeded the $${taskBudgetUsd.toFixed(2)} ceiling.`,
  );
}

const dataSource = [
  "// GENERATED by examples/video-studio/brand-gallery.ts — do not edit by hand.",
  "// This campaign, its references, reviews, rejected drafts, and delivery gate came from one agentic run.",
  `export const videoBrandGallery = ${JSON.stringify(result, null, 2)} as const;`,
  "",
].join("\n");
await writeFile(siteDataPath, dataSource);
await writeFile(join(outputDirectory, "result.json"), JSON.stringify(result, null, 2));

console.log(JSON.stringify({
  status: result.status,
  deliveredRun: result.deliveredRun,
  deliveredAssets: result.deliveredAssets,
  references: references.length,
  attempts: attempts.length,
  trackedRunCostUsd,
  trackedTaskSpendUsd,
  videoOperations: result.videoOperations,
  siteDataPath,
}, null, 2));

if (!deliveredRun) {
  throw new Error(
    `The campaign delivery gate held after ${studio.videoOperations.used()} video operations. Evidence was preserved in ${outputDirectory}.`,
  );
}
