import {
  Displaymanager,
  Glove,
  MemoryStore,
  createAdapter,
  type ModelAdapter,
  type SubscriberAdapter,
} from "glove-core";
import {
  InMemoryImageAssetStore,
  InMemoryImageLibrary,
  UsageMeter,
  expandCharacters,
  expandScenes,
  mountImage,
  openrouterImages,
  styleDirective,
} from "glove-image";
import {
  InMemoryVideoAssetStore,
  InMemoryVideoFlowStore,
  InMemoryVideoLibrary,
  InMemoryVideoReviewStore,
  VideoUsageMeter,
  defaultVideoPipeline,
  mountVideo,
  type MountVideoConfig,
  type VideoModelAdapter,
} from "glove-video";
import { localFfmpegVideo } from "./local-video-adapter";

export interface StudioOptions {
  stream?: boolean;
  subscribers?: SubscriberAdapter[];
  onVideoProgress?: MountVideoConfig["onProgress"];
  /** Defaults to the deterministic local ffmpeg reference adapter. */
  videoAdapter?: VideoModelAdapter;
  /** Hard cap across generate/extend/transform calls. Defaults to 3. */
  maxVideoOperations?: number;
  /** Defaults to Qwen 3.5 Plus through OpenRouter. */
  directorModel?: ModelAdapter;
  /** Defaults to the low-cost video-capable Qwen 3.5 Flash through OpenRouter. */
  reviewModel?: ModelAdapter;
  reviewPassingScore?: number;
  /** Restrict the director to read-only review and gated delivery of imported candidates. */
  auditOnly?: boolean;
  /** Replace the built-in production/audit role while keeping the mounted tool stack. */
  systemPrompt?: string;
}

export function withVideoOperationLimit(
  baseVideoAdapter: VideoModelAdapter,
  requestedMaximum = 3,
): {
  adapter: VideoModelAdapter;
  max: number;
  used: () => number;
} {
  const max = Math.max(1, Math.floor(requestedMaximum));
  let used = 0;
  const consume = () => {
    if (used >= max) {
      throw new Error(
        `Video operation budget exhausted (${used}/${max}). ` +
        "Do not generate another draft; report the strongest reviewed result or explain why none passed.",
      );
    }
    used += 1;
  };
  const adapter: VideoModelAdapter = {
    name: baseVideoAdapter.name,
    capabilities: baseVideoAdapter.capabilities,
    async generate(request, context) {
      consume();
      return baseVideoAdapter.generate(request, context);
    },
    ...(baseVideoAdapter.extend
      ? {
          async extend(request, context) {
            consume();
            return baseVideoAdapter.extend!(request, context);
          },
        }
      : {}),
    ...(baseVideoAdapter.transform
      ? {
          async transform(request, context) {
            consume();
            return baseVideoAdapter.transform!(request, context);
          },
        }
      : {}),
  };
  return { adapter, max, used: () => used };
}

export async function createVideoStudio(options: StudioOptions = {}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Set OPENROUTER_API_KEY before starting video-studio.");
  }

  const imageAssets = new InMemoryImageAssetStore();
  const imageLibrary = new InMemoryImageLibrary();
  const videoAssets = new InMemoryVideoAssetStore();
  const videoLibrary = new InMemoryVideoLibrary();
  const videoFlows = new InMemoryVideoFlowStore();
  const videoReviews = new InMemoryVideoReviewStore();
  const imageUsage = new UsageMeter();
  const videoUsage = new VideoUsageMeter();
  const reviewModel = options.reviewModel ?? createAdapter({
    provider: "openrouter",
    model: "qwen/qwen3.5-flash-02-23",
    stream: false,
  });
  const baseVideoAdapter = options.videoAdapter ?? localFfmpegVideo();
  const videoOperations = withVideoOperationLimit(
    baseVideoAdapter,
    options.maxVideoOperations ?? 3,
  );
  const productionPrompt = [
    "You are an autonomous creative director with both glove_image_* and glove_video_* tools.",
    "Own the full creative process. Infer a strong concept and make tasteful decisions instead of asking the user to art-direct routine choices.",
    "Use tools instead of merely describing what could be made.",
    "",
    "Mandatory production loop:",
    "1. Translate the request into a concrete concept, shot design, timed action, camera movement, sound, and acceptance criteria.",
    "2. For a single shot, generate and inspect a strong opening frame with glove_image. For recurring people or products, instead generate and inspect reusable identity/reference images, then save those img_* ids on the video character definition.",
    "3. Use first-frame refs for exact openings or identity/style refs for reference-to-video continuity. Do not mix them when the provider treats first-frame as taking precedence. Treat every returned vid_* as an internal draft.",
    "4. Call glove_video_review for every plausible draft. The reviewer watches the actual video from beginning to end against the brief.",
    `5. If a review says revise, use its revision_prompt with glove_video_regenerate or glove_video_transform, then review the new vid_*. Never exceed the hard ${videoOperations.max}-operation video budget.`,
    "6. For one clip, call glove_video_deliver exactly once for the strongest passing candidate. For a multi-shot flow, review every selected shot and call glove_video_flow_deliver exactly once. Only delivery tools can reveal final video.",
    "7. Never claim success, show, recommend, or return an unreviewed or failed vid_* to the user.",
    "",
    "Multi-shot workflow:",
    "- Save a flow with glove_video_flow_save, then run it with glove_video_flow_run.",
    "- Use continuity mode 'extend' for uninterrupted action or 'reference' for a matched cut.",
    "- Review every completed shot; revise failed shots before delivering any sequence with glove_video_flow_deliver.",
    "- Honor the requested duration, aspect ratio, resolution, and audio settings; glove-video fits unsupported values visibly.",
    "- In the final response, identify only the delivered vid_* plus a concise note about why it passed.",
  ].join("\n");
  const auditPrompt = [
    "You are a read-only video quality-control operator.",
    "Use glove_video_review exactly once for every imported candidate the user names.",
    "After all reviews, compare their recorded evidence. Call glove_video_deliver exactly once only for the strongest passing candidate.",
    "If none pass, deliver nothing and explain the blocking evidence.",
    "Never call image tools, video generation, regenerate, transform, extend, flow, character, or scene tools in audit mode.",
    "Never judge from filenames, prompts, or metadata; the reviewer must inspect the actual video.",
  ].join("\n");

  const agent = new Glove({
    store: new MemoryStore("video-studio"),
    model: options.directorModel ?? createAdapter({
        provider: "openrouter",
        model: "qwen/qwen3.5-plus-20260420",
        stream: options.stream ?? true,
      }),
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: options.systemPrompt ?? (options.auditOnly ? auditPrompt : productionPrompt),
    compaction_config: {
      compaction_instructions: "Keep image/video asset ids, saved characters/scenes, and flow run ids.",
    },
  });

  for (const subscriber of options.subscribers ?? []) agent.addSubscriber(subscriber);

  await mountImage(agent, {
    adapter: openrouterImages({
      model: "google/gemini-2.5-flash-image",
      title: "glove video-studio",
    }),
    assets: imageAssets,
    library: imageLibrary,
    review: {
      vision: reviewModel,
      rounds: 0,
      rubric: "The image must be compositionally strong, internally coherent, free of text/watermarks, and suitable as the exact opening frame of the intended motion.",
    },
    pipeline: [
      expandCharacters(),
      expandScenes(),
      styleDirective("faithfully execute the director's specified composition; no text, logo, border, or watermark unless explicitly requested"),
    ],
    usage: imageUsage,
  });

  await mountVideo(agent, {
    adapter: videoOperations.adapter,
    assets: videoAssets,
    library: videoLibrary,
    flows: videoFlows,
    pipeline: defaultVideoPipeline(),
    usage: videoUsage,
    review: {
      model: reviewModel,
      store: videoReviews,
      passingScore: options.reviewPassingScore ?? 82,
      rubric: "The finished clip must feel intentional and presentation-ready, remain temporally coherent, preserve the subject, execute the promised action and camera movement, and contain no distracting generation artifacts.",
    },
    resolveReference: async (ref) => {
      const image = await imageAssets.get(ref.asset);
      if (image) return { bytes: await imageAssets.bytes(ref.asset), mime: image.mime };
      const video = await videoAssets.get(ref.asset);
      if (video) return { bytes: await videoAssets.bytes(ref.asset), mime: video.mime };
      throw new Error(`Reference asset "${ref.asset}" not found in either store.`);
    },
    onProgress: options.onVideoProgress,
  });

  agent.build();
  return {
    agent,
    imageAssets,
    imageLibrary,
    videoAssets,
    videoLibrary,
    videoFlows,
    videoReviews,
    imageUsage,
    videoUsage,
    videoOperations: { max: videoOperations.max, used: videoOperations.used },
  };
}
