import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createAdapter, type SubscriberAdapter, type SubscriberEvent } from "glove-core";
import {
  inspectMp4Metadata,
  openrouterVideo,
  type VideoModelAdapter,
  type VideoModelCapabilities,
} from "glove-video";
import { sampledVideoReviewModel } from "./sampled-video-review";
import { createVideoStudio } from "./studio";

config({ quiet: true });
if (!process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY.");

const outputDirectory = fileURLToPath(new URL("./out/brand-gallery/", import.meta.url));
const siteVideoDirectory = fileURLToPath(
  new URL("../../packages/site/public/video-gallery/", import.meta.url),
);
const siteDataPath = fileURLToPath(
  new URL("../../packages/site/lib/video-brand-gallery-data.ts", import.meta.url),
);
const previous = JSON.parse(await readFile(join(outputDirectory, "result.json"), "utf8")) as any;
const priorTaskSpendUsd = Number.parseFloat(
  process.env.BRAND_PRIOR_TASK_SPEND_USD ?? String(previous.trackedTaskSpendUsd ?? 0),
);

const veoCapabilities: VideoModelCapabilities = {
  modes: ["text-to-video", "image-to-video", "extend"],
  maxRefs: 3,
  refRoles: ["first-frame", "last-frame", "identity", "style", "continuity"],
  durations: [4, 6, 8],
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p", "4K"],
  audio: true,
  negativePrompt: true,
  seed: false,
  maxCandidates: 1,
};
const baseVeo = openrouterVideo({
  model: "google/veo-3.1-fast",
  capabilities: veoCapabilities,
  pollIntervalMs: 10_000,
  maxPollAttempts: 120,
  title: "glove-video Aethel reference continuity campaign",
});
const videoAdapter: VideoModelAdapter = {
  ...baseVeo,
  async generate(request, context) {
    return baseVeo.generate({
      ...request,
      params: {
        ...request.params,
        extra: {
          ...request.params.extra,
          provider: {
            options: {
              "google-vertex": {
                parameters: {
                  personGeneration: "allow",
                  negativePrompt: "identity drift, different person, different hairstyle, different coat, text, logo, watermark, cuts, jump zoom, warped hands",
                },
              },
            },
          },
        },
      },
    }, context);
  },
};

let deliveredRun: string | undefined;
let deliveredAssets: string[] = [];
const toolSequence: string[] = [];
const toolErrors: Array<{ tool: string; message: string }> = [];
const seen = new Set<string>();
const capture: SubscriberAdapter = {
  async record(event, data) {
    if (event === "model_response" || event === "model_response_complete") {
      const value = data as Extract<SubscriberEvent, { type: "model_response" }>;
      for (const call of value.tool_calls ?? []) {
        const id = call.id ?? `${call.tool_name}:${toolSequence.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (call.tool_name.startsWith("glove_video_") || call.tool_name.startsWith("glove_image_")) {
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
  maxVideoOperations: 3,
  reviewPassingScore: 82,
  directorModel: createAdapter({
    provider: "openrouter",
    model: "qwen/qwen3.5-plus-20260420",
    stream: false,
  }),
  reviewModel: sampledVideoReviewModel(createAdapter({
    provider: "openrouter",
    model: "qwen/qwen3.5-flash-02-23",
    stream: false,
  })),
  videoAdapter,
  systemPrompt: [
    "You are the autonomous final production agent for the existing Aethel fashion campaign.",
    "The approved identity pack, recurring character, three scene definitions, and three-shot Veo flow are already loaded. Do not generate or edit images and do not replace the supplied creative concept.",
    "Run the named flow exactly once. Then inspect every generated shot with glove_video_review, including the supplied identity image ids in reference_assets.",
    "Be demanding about exact face, hair, skin tone, oxidized-copper coat, stable anatomy and backgrounds, continuous movement, no text/watermark, and no audio.",
    "If and only if all three latest reviews pass, call glove_video_flow_deliver exactly once. There is no revision allowance; a failed shot holds the campaign.",
  ].join("\n"),
  onVideoProgress(event) {
    const id = event.provider_job_id ?? "pending";
    const state = `${event.phase}:${Math.round((event.progress ?? 0) * 100)}`;
    if (progress.get(id) !== state) {
      progress.set(id, state);
      console.log(`video ${id}: ${event.phase} ${Math.round((event.progress ?? 0) * 100)}%`);
    }
  },
});

const referenceFiles = ["brand-reference-2.png", "brand-reference-5.png", "brand-reference-7.png"];
const referenceIds: string[] = [];
for (const file of referenceFiles) {
  const asset = await studio.imageAssets.put(
    new Uint8Array(await readFile(join(outputDirectory, file))),
    {
      name: file,
      mime: "image/png",
      width: 1024,
      height: 1024,
      source: "imported",
      tags: ["aethel", "identity", "veo"],
    },
  );
  referenceIds.push(asset.id);
}

const now = new Date().toISOString();
await studio.videoLibrary.saveCharacter({
  name: "aethel-model",
  display_name: "Aethel Campaign Model",
  appearance: "The exact same adult woman shown in all three identity reference images: warm olive skin, shoulder-length loose textured dark espresso waves with no bangs, athletic-elegant build, wearing the exact matte oxidized-copper wool double-breasted trench with wide sharp lapels, black buttons, waist shaping, and matching pockets.",
  performance: "Calm, controlled, natural movement; closed neutral mouth, relaxed shoulders, steady gaze.",
  negative: "identity drift, straight blunt bob, bangs, different skin tone, different coat, shiny satin, plastic fabric",
  refs: referenceIds.map((asset) => ({ asset, role: "identity" as const })),
  tags: ["aethel", "campaign", "veo"],
  created_at: now,
  updated_at: now,
});
await studio.videoLibrary.saveScene({
  name: "aethel-studio",
  setting: "Minimal premium photography studio, seamless pale sand backdrop, polished concrete floor, soft directional key light, warm neutral palette, editorial luxury.",
  ambient_motion: "Only a very slow dolly forward and one natural breath.",
  negative: "cuts, orbit, zoom jump, pose change, speaking",
  created_at: now,
  updated_at: now,
});
await studio.videoLibrary.saveScene({
  name: "aethel-city",
  setting: "Modernist architectural plaza at golden hour, stable limestone columns and concrete terraces, distant city softly blurred, long warm shadows.",
  ambient_motion: "Smooth side tracking while the model walks slowly; gentle breeze moves coat hem.",
  negative: "warped railings, shifting architecture, cuts, camera shake",
  created_at: now,
  updated_at: now,
});
await studio.videoLibrary.saveScene({
  name: "aethel-rooftop",
  setting: "Private rooftop terrace at blue hour, soft city bokeh, low stone balustrade, subtle amber practical light, contemplative premium mood.",
  ambient_motion: "Locked medium portrait with a nearly imperceptible push-in and gentle breeze.",
  negative: "cuts, abrupt head turn, lighting jump, speaking",
  created_at: now,
  updated_at: now,
});

await studio.videoFlows.saveFlow({
  name: "aethel-veo-launch",
  description: "Reference-driven Aethel campaign: one model and one hero coat across studio, city, and rooftop scenes.",
  shots: [
    {
      id: "studio-hero",
      intent: "Continuous waist-up hero portrait of the exact Aethel reference model and copper trench. Locked eye-level composition; only a subtle slow dolly forward. She holds a calm direct gaze with closed neutral lips and one natural breath. No pose or hand change.",
      characters: ["aethel-model"],
      scene: "aethel-studio",
      beats: [
        { at: 0, action: "Hold exact reference identity and waist-up pose" },
        { at: 2, action: "One subtle natural breath as camera advances slightly" },
        { at: 3.5, action: "Settle into direct gaze without changing pose" },
      ],
      negative: "text, logo, watermark, speech, lip movement, hands entering frame",
      params: { duration: 4, aspectRatio: "16:9", resolution: "720p", audio: false },
      tags: ["aethel", "studio", "veo"],
    },
    {
      id: "city-motion",
      intent: "The exact Aethel reference model in the exact copper trench walks at an unhurried pace through a modernist plaza. Smooth medium side-tracking shot, steady geometry, one continuous take, subtle coat movement.",
      characters: ["aethel-model"],
      scene: "aethel-city",
      beats: [
        { at: 0, action: "Begin smooth side-tracking medium shot" },
        { at: 2, action: "Model continues one calm natural walking cycle" },
        { at: 3.5, action: "Maintain identity, coat, and architectural geometry" },
      ],
      negative: "text, logo, watermark, fast stride, warped architecture, face turn",
      params: { duration: 4, aspectRatio: "16:9", resolution: "720p", audio: false },
      tags: ["aethel", "city", "veo"],
    },
    {
      id: "rooftop-close",
      intent: "The exact Aethel reference model in the exact copper trench stands at a blue-hour rooftop, already facing three-quarter toward camera. Locked medium portrait with tiny push-in, calm gaze, closed lips, gentle coat and hair movement only.",
      characters: ["aethel-model"],
      scene: "aethel-rooftop",
      beats: [
        { at: 0, action: "Hold stable three-quarter portrait and exact identity" },
        { at: 2, action: "Gentle breeze moves hair ends and coat edge" },
        { at: 3.5, action: "Finish on the same calm gaze and composition" },
      ],
      negative: "text, logo, watermark, head turn, speech, lighting change",
      params: { duration: 4, aspectRatio: "16:9", resolution: "720p", audio: false },
      tags: ["aethel", "rooftop", "veo"],
    },
  ],
  tags: ["aethel", "campaign", "veo"],
  created_at: now,
  updated_at: now,
});

await studio.agent.processRequest([
  "Run flow aethel-veo-launch now.",
  `For every generated asset, call glove_video_review with reference_assets [${referenceIds.join(", ")}].`,
  "Review each shot against its exact intent plus the campaign requirement that the person, wavy hair, skin tone, and matte copper trench match the reference images.",
  "If all three pass 82 with no major/critical issue, call glove_video_flow_deliver exactly once with the real run id.",
].join(" "));

if (!deliveredRun) {
  const runs = await studio.videoFlows.listRuns();
  const run = runs.at(-1);
  const reviews = await studio.videoReviews.list();
  await studio.agent.processRequest([
    run ? `Finish run ${run.id}. Shot assets: ${run.shots.map((shot) => `${shot.shot}=${shot.assets.join("|")}`).join(", ")}.` : "No run exists; report the failure.",
    `Reviews: ${reviews.map((review) => `${review.asset}:${review.decision}:${review.score}`).join(", ") || "none"}.`,
    `Identity refs: ${referenceIds.join(", ")}. Review any unreviewed shot. If every shot passes, call glove_video_flow_deliver for ${run?.id ?? "the real run id"}. Otherwise hold delivery.`,
  ].join(" "));
}

const videos = await studio.videoAssets.list();
const reviews = await studio.videoReviews.list();
const reviewByAsset = new Map(reviews.map((review) => [review.asset, review]));
const newAttempts: any[] = [];
for (let index = 0; index < videos.length; index += 1) {
  const video = videos[index]!;
  const file = `brand-veo-take-${index + 1}.mp4`;
  const bytes = await studio.videoAssets.bytes(video.id);
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  const metadata = inspectMp4Metadata(bytes);
  const review = reviewByAsset.get(video.id);
  newAttempts.push({
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
    review: review ? {
      decision: review.decision,
      score: review.score,
      summary: review.summary,
      strengths: review.strengths,
      issues: review.issues,
      revisionPrompt: review.revision_prompt,
      reviewer: review.reviewer,
      costUsd: review.usage?.cost_usd ?? 0,
      referenceAssets: review.reference_assets ?? [],
    } : null,
  });
}

for (const attempt of previous.attempts) attempt.selected = false;
previous.attempts.push(...newAttempts);
const imageUsage = studio.imageUsage.report();
const videoUsage = studio.videoUsage.report();
const trackedVeoCostUsd = (imageUsage.total.cost_usd ?? 0) + (videoUsage.total.cost_usd ?? 0);
previous.status = deliveredRun ? "delivered" : "gate-held";
previous.deliveredRun = deliveredRun ?? null;
previous.deliveredAssets = deliveredAssets;
previous.models = {
  ...previous.models,
  director: "qwen/qwen3.5-plus-20260420",
  reviewer: "qwen/qwen3.5-flash-02-23",
  video: "google/veo-3.1-fast",
};
previous.trackedVeoCostUsd = trackedVeoCostUsd;
previous.trackedTaskSpendUsd = priorTaskSpendUsd + trackedVeoCostUsd;
previous.videoOperations = {
  used: Number(previous.videoOperations?.used ?? 0) + studio.videoOperations.used(),
  max: Number(previous.videoOperations?.max ?? 0) + 3,
};
previous.veoRun = {
  deliveredRun: deliveredRun ?? null,
  deliveredAssets,
  referenceIds,
  flowRuns: await studio.videoFlows.listRuns(),
  toolSequence,
  toolErrors,
  usage: { image: imageUsage, video: videoUsage },
};

const dataSource = [
  "// GENERATED by the agentic brand gallery runners — do not edit by hand.",
  "// Identity pack, model fallback, every draft review, and the final sequence gate are recorded evidence.",
  `export const videoBrandGallery = ${JSON.stringify(previous, null, 2)} as const;`,
  "",
].join("\n");
await writeFile(siteDataPath, dataSource);
await writeFile(join(outputDirectory, "result.json"), JSON.stringify(previous, null, 2));

console.log(JSON.stringify({
  status: previous.status,
  deliveredRun: previous.deliveredRun,
  deliveredAssets,
  attempts: newAttempts.map((attempt) => ({ id: attempt.id, shot: attempt.shot, review: attempt.review && { decision: attempt.review.decision, score: attempt.review.score } })),
  trackedVeoCostUsd,
  trackedTaskSpendUsd: previous.trackedTaskSpendUsd,
}, null, 2));

if (!deliveredRun) throw new Error("The Veo reference-continuity gate held; no sequence was delivered.");
