import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createAdapter, type SubscriberAdapter, type SubscriberEvent } from "glove-core";
import {
  inspectMp4Metadata,
  openrouterVideo,
  type VideoFlowDefinition,
  type VideoFlowRun,
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
const priorResult = JSON.parse(
  await readFile(join(outputDirectory, "result.json"), "utf8"),
) as any;
const priorTaskSpendUsd = Number.parseFloat(
  process.env.BRAND_PRIOR_TASK_SPEND_USD ?? String(priorResult.trackedTaskSpendUsd ?? 0),
);

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

let delivered = false;
let deliveredRun: string | undefined;
let deliveredInternalAssets: string[] = [];
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
        delivered = true;
        deliveredRun = result?.run;
        deliveredInternalAssets = result?.shots?.flatMap((shot) => shot.asset?.id ? [shot.asset.id] : []) ?? [];
      }
    }
  },
};

const progress = new Map<string, string>();
const studio = await createVideoStudio({
  stream: false,
  subscribers: [capture],
  maxVideoOperations: 1,
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
  videoAdapter: openrouterVideo({
    model: "bytedance/seedance-2.0",
    capabilities: seedanceCapabilities,
    pollIntervalMs: 10_000,
    maxPollAttempts: 120,
    title: "glove-video Aethel campaign finishing pass",
  }),
  systemPrompt: [
    "You are the autonomous finishing editor for an existing three-shot fashion campaign.",
    "The identity pack, campaign concept, two approved scene drafts, flow run, character, and studio scene are already loaded. Do not generate images, save new definitions, or rerun the flow.",
    "You have exactly one video generation operation. Use it only to create the requested studio replacement with glove_video_generate.",
    "Then inspect the replacement, city, and rooftop videos with glove_video_review, passing every supplied identity image id in reference_assets.",
    "The reviewer must compare face, hair, skin tone, and copper trench against those images, as well as judge anatomy, temporal coherence, camera, action, artifacts, text, and audio.",
    "If every selected scene passes, call glove_video_flow_deliver exactly once for the supplied run and replace only the studio shot. If any scene fails, do not deliver.",
    "Never claim delivery unless glove_video_flow_deliver succeeds.",
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
const referenceAssets = [];
for (const file of referenceFiles) {
  referenceAssets.push(await studio.imageAssets.put(
    new Uint8Array(await readFile(join(outputDirectory, file))),
    {
      name: file,
      mime: "image/png",
      width: 1024,
      height: 1024,
      source: "imported",
      tags: ["aethel", "identity", "recovery"],
    },
  ));
}
const referenceIds = referenceAssets.map((asset) => asset.id);

const importedByShot = new Map<string, string>();
for (const shot of ["shot-1-studio", "shot-2-city", "shot-3-rooftop"]) {
  const previous = priorResult.attempts.find((attempt: any) => attempt.shot === shot);
  if (!previous) throw new Error(`Missing prior attempt for ${shot}.`);
  const bytes = new Uint8Array(await readFile(join(outputDirectory, previous.file)));
  const metadata = inspectMp4Metadata(bytes);
  const imported = await studio.videoAssets.put(bytes, {
    name: `Imported ${shot}`,
    mime: "video/mp4",
    width: metadata.width ?? previous.width,
    height: metadata.height ?? previous.height,
    duration: metadata.duration ?? previous.duration,
    has_audio: metadata.has_audio ?? previous.hasAudio,
    source: "imported",
    tags: ["aethel", shot, "recovery"],
  });
  importedByShot.set(shot, imported.id);
}

await studio.videoLibrary.saveCharacter({
  name: "aethel-model-noref",
  display_name: "Aethel Campaign Model",
  appearance: "An adult woman, 32 years old, warm olive skin tone, shoulder-length textured dark espresso bob hairstyle, athletic-elegant build approximately 5'7 with balanced proportions, wearing a structured wool-blend trench coat in oxidized copper with sharp lapels and double-breasted closure. Her expression is calm, confident, and direct.",
  performance: "Calm, controlled, natural movement with relaxed shoulders and a steady gaze.",
  tags: ["aethel", "campaign", "recovery"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
await studio.videoLibrary.saveScene({
  name: "aethel-studio-hero",
  display_name: "Aethel Studio Hero Reveal",
  setting: "A pristine minimal photography studio with a seamless pale sand backdrop and polished concrete floor. Soft directional studio lighting, warm sand and terracotta palette, editorial luxury, controlled elegance.",
  ambient_motion: "Only a slow, subtle camera push and barely perceptible fabric movement.",
  negative: "cuts, jump zooms, abrupt pose changes, text, logo, watermark",
  tags: ["aethel", "studio", "recovery"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const now = new Date().toISOString();
const definition: VideoFlowDefinition = {
  name: "aethel-launch-recovery",
  description: "Finishing gate for the Aethel three-scene launch campaign.",
  shots: [
    { id: "shot-1-studio", intent: "Studio hero portrait" },
    { id: "shot-2-city", intent: "Architectural city movement" },
    { id: "shot-3-rooftop", intent: "After-hours rooftop portrait" },
  ],
  tags: ["aethel", "recovery"],
  created_at: now,
  updated_at: now,
};
const recoveryRun: VideoFlowRun = {
  id: "vflow_aethel_finishing_gate",
  flow: definition.name,
  definition,
  status: "succeeded",
  shots: definition.shots.map((shot) => ({
    shot: shot.id,
    status: "succeeded",
    attempts: 1,
    assets: [importedByShot.get(shot.id)!],
    started_at: now,
    completed_at: now,
  })),
  created_at: now,
  started_at: now,
  completed_at: now,
};
await studio.videoFlows.saveFlow(definition);
await studio.videoFlows.saveRun(recoveryRun);

const request = [
  `Finish flow run ${recoveryRun.id}.`,
  `Identity reference assets: ${referenceIds.join(", ")}. Pass all three in reference_assets on every review.`,
  `Existing city asset: ${importedByShot.get("shot-2-city")}. Existing rooftop asset: ${importedByShot.get("shot-3-rooftop")}.`,
  "Generate one replacement for shot-1-studio using character aethel-model-noref and scene aethel-studio-hero.",
  "Studio replacement direction: a continuous waist-up editorial portrait of the Aethel model in the oxidized copper trench. Locked eye-level camera with only a very slow five-percent dolly forward. She remains still except for one natural breath and a subtle gaze settling into lens. No hand action, no orbit, no reframing jump, no cuts, no zoom, no pose change. Five seconds, 16:9, 720p, no audio, one take.",
  "Review the replacement and both existing scene assets. For each: require identity and copper-trench continuity against the three images, stable face and hands, continuous camera/action, no text, no watermark, and no audio.",
  `If all three pass, call glove_video_flow_deliver with run ${recoveryRun.id} and replacements [{"shot":"shot-1-studio","asset":"NEW_ID"}], substituting the real new id.`,
].join(" ");
await studio.agent.processRequest(request);

const allVideos = await studio.videoAssets.list();
const generated = allVideos.find((asset) => asset.source === "generated");
const reviews = await studio.videoReviews.list();
const reviewByInternalAsset = new Map(reviews.map((review) => [review.asset, review]));
const originalIdByImported = new Map<string, string>();
for (const [shot, imported] of importedByShot) {
  const previous = priorResult.attempts.find((attempt: any) => attempt.shot === shot);
  originalIdByImported.set(imported, previous.id);
}

for (const attempt of priorResult.attempts) {
  attempt.selected = false;
  const imported = importedByShot.get(attempt.shot);
  const fresh = imported ? reviewByInternalAsset.get(imported) : undefined;
  if (fresh) {
    attempt.review = {
      decision: fresh.decision,
      score: fresh.score,
      summary: fresh.summary,
      strengths: fresh.strengths,
      issues: fresh.issues,
      revisionPrompt: fresh.revision_prompt,
      reviewer: fresh.reviewer,
      costUsd: fresh.usage?.cost_usd ?? 0,
      referenceAssets: fresh.reference_assets ?? [],
    };
  }
}

let revisionAttempt: any = null;
if (generated) {
  const bytes = await studio.videoAssets.bytes(generated.id);
  const file = "brand-take-4.mp4";
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  const metadata = inspectMp4Metadata(bytes);
  const review = reviewByInternalAsset.get(generated.id);
  revisionAttempt = {
    id: generated.id,
    file,
    shot: "shot-1-studio-revision",
    flowRun: recoveryRun.id,
    selected: false,
    width: metadata.width ?? generated.width,
    height: metadata.height ?? generated.height,
    duration: metadata.duration ?? generated.duration,
    hasAudio: metadata.has_audio ?? generated.has_audio ?? false,
    source: generated.source,
    parent: generated.recipe?.parent ?? null,
    intent: generated.recipe?.intent ?? "",
    finalPrompt: generated.recipe?.finalPrompt ?? "",
    beats: generated.recipe?.beats ?? [],
    trace: generated.recipe?.trace ?? [],
    refs: generated.recipe?.refs ?? [],
    costUsd: generated.recipe?.usage?.cost_usd ?? 0,
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
  };
  priorResult.attempts.push(revisionAttempt);
}

if (delivered && generated) {
  revisionAttempt.selected = true;
  for (const attempt of priorResult.attempts) {
    if (attempt.shot === "shot-2-city" || attempt.shot === "shot-3-rooftop") {
      attempt.selected = true;
    }
  }
}

const recoveryImageUsage = studio.imageUsage.report();
const recoveryVideoUsage = studio.videoUsage.report();
const trackedRecoveryCostUsd =
  (recoveryImageUsage.total.cost_usd ?? 0) + (recoveryVideoUsage.total.cost_usd ?? 0);
priorResult.status = delivered ? "delivered" : "gate-held";
priorResult.deliveredRun = deliveredRun ?? null;
priorResult.deliveredAssets = delivered
  ? [generated!.id, priorResult.attempts.find((a: any) => a.shot === "shot-2-city").id, priorResult.attempts.find((a: any) => a.shot === "shot-3-rooftop").id]
  : [];
priorResult.trackedRecoveryCostUsd = trackedRecoveryCostUsd;
priorResult.trackedTaskSpendUsd = priorTaskSpendUsd + trackedRecoveryCostUsd;
priorResult.recovery = {
  run: recoveryRun.id,
  delivered,
  deliveredInternalAssets,
  importedAssets: Object.fromEntries(importedByShot),
  originalIdsByImported: Object.fromEntries(originalIdByImported),
  referenceIds,
  toolSequence,
  toolErrors,
  usage: { image: recoveryImageUsage, video: recoveryVideoUsage },
};
priorResult.videoOperations = {
  used: Number(priorResult.videoOperations?.used ?? 0) + studio.videoOperations.used(),
  max: Number(priorResult.videoOperations?.max ?? 0) + 1,
};

const dataSource = [
  "// GENERATED by examples/video-studio/brand-gallery.ts and brand-recover.ts — do not edit by hand.",
  "// The campaign, identity references, reviews, rejected draft, targeted revision, and sequence gate are recorded evidence.",
  `export const videoBrandGallery = ${JSON.stringify(priorResult, null, 2)} as const;`,
  "",
].join("\n");
await writeFile(siteDataPath, dataSource);
await writeFile(join(outputDirectory, "result.json"), JSON.stringify(priorResult, null, 2));

console.log(JSON.stringify({
  status: priorResult.status,
  deliveredRun: priorResult.deliveredRun,
  deliveredAssets: priorResult.deliveredAssets,
  generated: generated?.id ?? null,
  reviews: reviews.map((review) => ({ asset: review.asset, decision: review.decision, score: review.score })),
  trackedRecoveryCostUsd,
  trackedTaskSpendUsd: priorResult.trackedTaskSpendUsd,
}, null, 2));

if (!delivered) throw new Error("The finishing gate held; no campaign sequence was delivered.");
