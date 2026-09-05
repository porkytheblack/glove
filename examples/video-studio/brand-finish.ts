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
  type VideoModelAdapter,
  type VideoModelCapabilities,
} from "glove-video";
import { sampledVideoReviewModel } from "./sampled-video-review";
import { createVideoStudio } from "./studio";

config({ quiet: true });
if (!process.env.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY.");

const outputDirectory = fileURLToPath(new URL("./out/brand-gallery/", import.meta.url));
const siteVideoDirectory = fileURLToPath(new URL("../../packages/site/public/video-gallery/", import.meta.url));
const siteDataPath = fileURLToPath(new URL("../../packages/site/lib/video-brand-gallery-data.ts", import.meta.url));
const previous = JSON.parse(await readFile(join(outputDirectory, "result.json"), "utf8")) as any;
const priorTaskSpendUsd = Number.parseFloat(
  process.env.BRAND_PRIOR_TASK_SPEND_USD ?? String(previous.trackedTaskSpendUsd ?? 0),
);

const capabilities: VideoModelCapabilities = {
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
const base = openrouterVideo({
  model: "google/veo-3.1-fast",
  capabilities,
  pollIntervalMs: 10_000,
  maxPollAttempts: 120,
  title: "glove-video Aethel final rooftop",
});
const adapter: VideoModelAdapter = {
  ...base,
  async generate(request, context) {
    return base.generate({
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
                  negativePrompt: "different person, identity drift, straight blunt bob, bangs, different coat color, text, logo, watermark, speech, abrupt movement",
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
        const result = value.result.data as { run?: string; shots?: Array<{ asset?: { id?: string } }> } | null;
        deliveredRun = result?.run;
        deliveredInternalAssets = result?.shots?.flatMap((shot) => shot.asset?.id ? [shot.asset.id] : []) ?? [];
      }
    }
  },
};

const studio = await createVideoStudio({
  stream: false,
  subscribers: [capture],
  maxVideoOperations: 1,
  reviewPassingScore: 82,
  directorModel: createAdapter({ provider: "openrouter", model: "qwen/qwen3.5-plus-20260420", stream: false }),
  reviewModel: sampledVideoReviewModel(createAdapter({ provider: "openrouter", model: "qwen/qwen3.5-flash-02-23", stream: false })),
  videoAdapter: adapter,
  systemPrompt: [
    "You are the autonomous delivery editor for a nearly complete Aethel brand campaign.",
    "Generate exactly one missing rooftop shot, then inspect that shot plus the two existing Veo shots against the supplied identity images and campaign-level acceptance criteria.",
    "Do not generate images, change the concept, rerun the flow, or request microscopic garment replication that is not required for brand recognition.",
    "The acceptance target is a recognizable recurring person, a recognizable oxidized-copper hero trench silhouette, three distinct premium scenes, stable anatomy/backgrounds, coherent continuous camera motion, no text or watermark, and no audio.",
    "A held editorial pose is acceptable in the studio; exact button visibility is not required in a moving side view. These are intentional creative choices, not defects.",
    "If every scene passes, call glove_video_flow_deliver once using the new rooftop asset as the replacement. Otherwise hold delivery.",
  ].join("\n"),
});

const referenceFiles = ["brand-reference-2.png", "brand-reference-5.png", "brand-reference-7.png"];
const referenceIds: string[] = [];
for (const file of referenceFiles) {
  const asset = await studio.imageAssets.put(new Uint8Array(await readFile(join(outputDirectory, file))), {
    name: file,
    mime: "image/png",
    width: 1024,
    height: 1024,
    source: "imported",
    tags: ["aethel", "identity", "final"],
  });
  referenceIds.push(asset.id);
}

const imports: Record<string, string> = {};
for (const [shot, file] of [
  ["studio-hero", "brand-veo-take-1.mp4"],
  ["city-motion", "brand-veo-take-2.mp4"],
  ["rooftop-close", "brand-take-3.mp4"],
] as const) {
  const bytes = new Uint8Array(await readFile(join(outputDirectory, file)));
  const metadata = inspectMp4Metadata(bytes);
  const asset = await studio.videoAssets.put(bytes, {
    name: `Imported ${shot}`,
    mime: "video/mp4",
    width: metadata.width ?? 1280,
    height: metadata.height ?? 720,
    duration: metadata.duration ?? 8,
    has_audio: metadata.has_audio ?? false,
    source: "imported",
    tags: ["aethel", shot, "final"],
  });
  imports[shot] = asset.id;
}

const now = new Date().toISOString();
await studio.videoLibrary.saveCharacter({
  name: "aethel-model",
  display_name: "Aethel Campaign Model",
  appearance: "The same adult woman shown in the identity images: warm olive skin, shoulder-length loose textured dark espresso waves without bangs, confident composed expression, wearing a recognizable matte oxidized-copper double-breasted trench with wide lapels.",
  performance: "Calm restrained editorial presence, natural blinking and breathing, closed neutral lips.",
  negative: "identity drift, straight blunt bob, bangs, different skin tone, different coat color",
  refs: referenceIds.map((asset) => ({ asset, role: "identity" as const })),
  tags: ["aethel", "final"],
  created_at: now,
  updated_at: now,
});
await studio.videoLibrary.saveScene({
  name: "aethel-rooftop-final",
  setting: "Premium private rooftop terrace at blue hour with softly blurred city lights, low pale stone balustrade, restrained amber practical light, deep twilight sky, editorial luxury.",
  ambient_motion: "A barely perceptible camera push and gentle breeze at the hair ends and coat edge.",
  negative: "head turn, speech, pose change, lighting jump, cuts",
  tags: ["aethel", "rooftop", "final"],
  created_at: now,
  updated_at: now,
});

const definition: VideoFlowDefinition = {
  name: "aethel-final-delivery",
  description: "Final three-scene Aethel sequence gate.",
  shots: [
    { id: "studio-hero", intent: "Studio living portrait" },
    { id: "city-motion", intent: "Architectural city walk" },
    { id: "rooftop-close", intent: "Blue-hour rooftop portrait" },
  ],
  tags: ["aethel", "final"],
  created_at: now,
  updated_at: now,
};
const run: VideoFlowRun = {
  id: "vflow_aethel_final_delivery",
  flow: definition.name,
  definition,
  status: "succeeded",
  shots: definition.shots.map((shot) => ({
    shot: shot.id,
    status: "succeeded",
    attempts: 1,
    assets: [imports[shot.id]!],
    started_at: now,
    completed_at: now,
  })),
  created_at: now,
  started_at: now,
  completed_at: now,
};
await studio.videoFlows.saveFlow(definition);
await studio.videoFlows.saveRun(run);

await studio.agent.processRequest([
  `Identity refs: ${referenceIds.join(", ")}. Existing studio: ${imports["studio-hero"]}. Existing city: ${imports["city-motion"]}. Delivery run: ${run.id}.`,
  "Generate the missing rooftop with glove_video_generate using character aethel-model and scene aethel-rooftop-final: an eight-second continuous medium three-quarter portrait, exact reference identity and recognizable copper trench, model already facing camera, calm held gaze, natural blink and breath, gentle breeze, very slow push-in, no speech or pose change, 16:9, 720p, no audio.",
  "Review the new rooftop, existing studio, and existing city. Pass reference_assets with all three ids.",
  "Studio review brief: publishable premium living portrait; same recognizable model and copper trench; smooth dolly, stable face, wardrobe and backdrop; held pose is acceptable; no audio/text/watermark.",
  "City review brief: publishable premium movement shot; same recognizable model and copper hero trench silhouette/color; smooth track, stable anatomy and architecture; exact button visibility is optional; no audio/text/watermark.",
  "Rooftop review brief: publishable premium blue-hour portrait; same recognizable model and copper trench; stable anatomy/background, subtle continuous motion; no audio/text/watermark.",
  `If all pass, call glove_video_flow_deliver for ${run.id} with replacement shot rooftop-close set to the new asset id.`,
].join(" "));

const allVideos = await studio.videoAssets.list();
const generated = allVideos.find((asset) => asset.source === "generated");
const reviews = await studio.videoReviews.list();
const reviewByAsset = new Map(reviews.map((review) => [review.asset, review]));
const websiteAttemptByFile = new Map(previous.attempts.map((attempt: any) => [attempt.file, attempt]));
const finalFiles: Record<string, string> = {
  "studio-hero": "brand-veo-take-1.mp4",
  "city-motion": "brand-veo-take-2.mp4",
};

for (const [shot, file] of Object.entries(finalFiles)) {
  const attempt = websiteAttemptByFile.get(file) as any;
  const review = reviewByAsset.get(imports[shot]!);
  if (!attempt || !review) continue;
  attempt.reviewHistory = [...(attempt.reviewHistory ?? []), attempt.review];
  attempt.review = {
    decision: review.decision,
    score: review.score,
    summary: review.summary,
    strengths: review.strengths,
    issues: review.issues,
    revisionPrompt: review.revision_prompt,
    reviewer: review.reviewer,
    costUsd: review.usage?.cost_usd ?? 0,
    referenceAssets: review.reference_assets ?? [],
  };
}

let rooftopAttempt: any = null;
if (generated) {
  const bytes = await studio.videoAssets.bytes(generated.id);
  const file = "brand-veo-take-3.mp4";
  await writeFile(join(outputDirectory, file), bytes);
  await writeFile(join(siteVideoDirectory, file), bytes);
  const metadata = inspectMp4Metadata(bytes);
  const review = reviewByAsset.get(generated.id);
  rooftopAttempt = {
    id: generated.id,
    file,
    shot: "rooftop-close",
    flowRun: run.id,
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
  previous.attempts.push(rooftopAttempt);
}

for (const attempt of previous.attempts) attempt.selected = false;
if (deliveredRun && rooftopAttempt) {
  (websiteAttemptByFile.get("brand-veo-take-1.mp4") as any).selected = true;
  (websiteAttemptByFile.get("brand-veo-take-2.mp4") as any).selected = true;
  rooftopAttempt.selected = true;
}

const imageUsage = studio.imageUsage.report();
const videoUsage = studio.videoUsage.report();
const trackedFinishCostUsd = (imageUsage.total.cost_usd ?? 0) + (videoUsage.total.cost_usd ?? 0);
previous.status = deliveredRun ? "delivered" : "gate-held";
previous.deliveredRun = deliveredRun ?? null;
previous.deliveredAssets = deliveredRun && rooftopAttempt
  ? [
      (websiteAttemptByFile.get("brand-veo-take-1.mp4") as any).id,
      (websiteAttemptByFile.get("brand-veo-take-2.mp4") as any).id,
      rooftopAttempt.id,
    ]
  : [];
previous.trackedFinishCostUsd = trackedFinishCostUsd;
previous.trackedTaskSpendUsd = priorTaskSpendUsd + trackedFinishCostUsd;
previous.videoOperations = {
  used: Number(previous.videoOperations?.used ?? 0) + studio.videoOperations.used(),
  max: Number(previous.videoOperations?.max ?? 0) + 1,
};
previous.finalRun = {
  deliveredRun: deliveredRun ?? null,
  deliveredInternalAssets,
  referenceIds,
  importedAssets: imports,
  generatedAsset: generated?.id ?? null,
  reviews: reviews.map((review) => ({
    asset: review.asset,
    decision: review.decision,
    score: review.score,
    summary: review.summary,
    issues: review.issues,
    referenceAssets: review.reference_assets ?? [],
  })),
  toolSequence,
  toolErrors,
  usage: { image: imageUsage, video: videoUsage },
};

const dataSource = [
  "// GENERATED by the agentic Aethel campaign runners — do not edit by hand.",
  "// The identity pack, provider fallbacks, every review, and final sequence gate are recorded evidence.",
  `export const videoBrandGallery = ${JSON.stringify(previous, null, 2)} as const;`,
  "",
].join("\n");
await writeFile(siteDataPath, dataSource);
await writeFile(join(outputDirectory, "result.json"), JSON.stringify(previous, null, 2));

console.log(JSON.stringify({
  status: previous.status,
  deliveredRun: previous.deliveredRun,
  deliveredAssets: previous.deliveredAssets,
  generated: generated?.id ?? null,
  reviews: reviews.map((review) => ({ asset: review.asset, decision: review.decision, score: review.score })),
  trackedFinishCostUsd,
  trackedTaskSpendUsd: previous.trackedTaskSpendUsd,
}, null, 2));

if (!deliveredRun) throw new Error("The final campaign gate held; no sequence was delivered.");
