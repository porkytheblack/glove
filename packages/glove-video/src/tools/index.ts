import z from "zod";
import type {
  ContentPart,
  GloveFoldArgs,
  ModelAdapter,
  NotifySubscribersFunction,
  ToolResultData,
} from "glove-core";
import {
  type ResolvedVideoReference,
  type VideoAsset,
  type VideoAssetStore,
  type VideoCallContext,
  type VideoCharacterDef,
  type VideoGenerateRequest,
  type VideoLibraryAdapter,
  type VideoModelAdapter,
  type VideoModelResult,
  type VideoProgress,
  type VideoRecipe,
  type VideoReference,
  type VideoReferenceResolver,
  type VideoReview,
  type VideoReviewIssue,
  type VideoReviewStore,
  type VideoSceneDef,
  type VideoUsage,
  type VideoUsageSource,
  VideoError,
  VideoUsageMeter,
  addVideoUsage,
  emptyVideoUsage,
  generateVideoReviewId,
  videoFromDataUrl,
  videoNowIso,
} from "../core/index";
import {
  type VideoFlowDefinition,
  type VideoFlowRun,
  type VideoFlowShot,
  type VideoFlowStore,
  runVideoFlow,
  validateVideoFlow,
} from "../flows/index";
import {
  type VideoPromptDraft,
  type VideoPromptEnhancer,
  createVideoDraft,
  defaultVideoPipeline,
  fitVideoToModel,
  runVideoPipeline,
} from "../pipeline/index";

const noopNotify: NotifySubscribersFunction = async () => {};

export type VideoMountTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
};

export interface VideoReviewConfig {
  /** A model that can inspect video content, not just images or metadata. */
  model: ModelAdapter;
  /** Durable review history. Defaults to a session-local in-memory store. */
  store?: VideoReviewStore;
  /** Additional project-specific acceptance criteria. */
  rubric?: string;
  /** Minimum 0..100 score required before delivery. Defaults to 80. */
  passingScore?: number;
}

export interface MountVideoConfig {
  adapter: VideoModelAdapter;
  assets: VideoAssetStore;
  library: VideoLibraryAdapter;
  flows: VideoFlowStore;
  pipeline?: VideoPromptEnhancer[];
  model?: ModelAdapter;
  curate?: boolean;
  candidates?: number;
  /** Enable agent-driven inspect → critique → revise → approve tools. */
  review?: VideoReviewConfig;
  requirePermission?: boolean;
  usage?: VideoUsageMeter;
  onUsage?: (source: VideoUsageSource, usage: VideoUsage) => void;
  /**
   * Resolve image or video ids used as model references. Defaults to the
   * video asset store; compose this with glove-image for image ids.
   */
  resolveReference?: VideoReferenceResolver;
  /** Receives provider progress for UIs, logs, or subscribers. */
  onProgress?: (
    event: VideoProgress & { operation: "generate" | "extend" | "transform"; run?: string; shot?: string },
  ) => void | Promise<void>;
}

interface ToolContext {
  adapter: VideoModelAdapter;
  assets: VideoAssetStore;
  library: VideoLibraryAdapter;
  flows: VideoFlowStore;
  pipeline: VideoPromptEnhancer[];
  model?: ModelAdapter;
  defaultCandidates: number;
  review?: {
    model: ModelAdapter;
    store: VideoReviewStore;
    rubric?: string;
    passingScore: number;
  };
  meter: VideoUsageMeter;
  onUsage?: MountVideoConfig["onUsage"];
  resolveReference: VideoReferenceResolver;
  onProgress?: MountVideoConfig["onProgress"];
}

class SessionVideoReviewStore implements VideoReviewStore {
  readonly identifier = "session-video-reviews";
  private values: VideoReview[] = [];

  async save(review: VideoReview): Promise<void> {
    this.values.push(structuredClone(review));
  }

  async latest(asset: string): Promise<VideoReview | null> {
    for (let index = this.values.length - 1; index >= 0; index--) {
      const value = this.values[index]!;
      if (value.asset === asset) return structuredClone(value);
    }
    return null;
  }

  async list(asset?: string): Promise<VideoReview[]> {
    return structuredClone(asset ? this.values.filter((review) => review.asset === asset) : this.values);
  }
}

interface GenerationOptions {
  name?: string;
  tags?: string[];
  operation: "generate" | "extend" | "transform";
  parent?: string;
  flow?: { run: string; shot: string };
}

interface GenerationOutcome {
  assets: VideoAsset[];
  finalPrompt: string;
  degradations: string[];
  revised_prompt?: string;
  provider_job_ids?: string[];
  usage: VideoUsage;
}

function errorResult(message: string): ToolResultData {
  return { status: "error", data: null, message };
}

function recordUsage(
  ctx: ToolContext,
  source: VideoUsageSource,
  value: Partial<VideoUsage>,
  total?: VideoUsage,
): void {
  const normalized = addVideoUsage(emptyVideoUsage(), value);
  ctx.meter.record(source, normalized);
  if (total) addVideoUsage(total, normalized);
  ctx.onUsage?.(source, normalized);
}

function assetSummary(asset: VideoAsset): Record<string, unknown> {
  return {
    id: asset.id,
    name: asset.name,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    fps: asset.fps,
    has_audio: asset.has_audio,
    source: asset.source,
    tags: asset.tags,
  };
}

async function playableSummary(
  ctx: ToolContext,
  asset: VideoAsset,
): Promise<Record<string, unknown>> {
  let url: string | undefined;
  if (ctx.assets.url) {
    try {
      url = await ctx.assets.url(asset.id);
    } catch {
      // A preview URL is optional render-only data. A signing outage must not
      // turn a completed, stored generation into a failed tool call.
    }
  }
  return {
    ...assetSummary(asset),
    url,
  };
}

async function reviewState(
  ctx: ToolContext,
  asset: string,
): Promise<{ review_required: boolean; approved: boolean; latest_review?: VideoReview }> {
  if (!ctx.review) return { review_required: false, approved: true };
  const latest = await ctx.review.store.latest(asset);
  return {
    review_required: true,
    approved: latest?.decision === "pass",
    ...(latest ? { latest_review: latest } : {}),
  };
}

async function resolveRefs(
  ctx: ToolContext,
  refs: VideoReference[],
): Promise<ResolvedVideoReference[]> {
  return Promise.all(
    refs.map(async (ref) => ({ ...ref, ...(await ctx.resolveReference(ref)) })),
  );
}

function degradations(draft: VideoPromptDraft): string[] {
  return draft.trace
    .filter((entry) => entry.note)
    .map((entry) => `${entry.enhancer}: ${entry.note}`);
}

async function sourceBytes(
  ctx: ToolContext,
  id: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const asset = await ctx.assets.get(id);
  if (!asset) throw new VideoError(`Video asset "${id}" not found`);
  return { bytes: await ctx.assets.bytes(id), mime: asset.mime };
}

function callContext(
  ctx: ToolContext,
  options: GenerationOptions,
  signal?: AbortSignal,
): VideoCallContext {
  return {
    signal,
    onProgress: ctx.onProgress
      ? (event) =>
          ctx.onProgress!({
            ...event,
            operation: options.operation,
            run: options.flow?.run,
            shot: options.flow?.shot,
          })
      : undefined,
  };
}

async function invokeAdapter(
  ctx: ToolContext,
  draft: VideoPromptDraft,
  options: GenerationOptions,
  signal?: AbortSignal,
): Promise<VideoModelResult> {
  const request: VideoGenerateRequest = {
    prompt: draft.prompt,
    negative: draft.negative,
    refs: await resolveRefs(ctx, draft.refs),
    beats: draft.beats.length ? draft.beats : undefined,
    params: draft.params,
  };
  const callCtx = callContext(ctx, options, signal);
  if (options.operation === "extend") {
    if (!options.parent || !ctx.adapter.extend || !ctx.adapter.capabilities.modes.includes("extend")) {
      throw new VideoError(`The "${ctx.adapter.name}" adapter does not support extension.`);
    }
    return ctx.adapter.extend(
      { ...request, source: await sourceBytes(ctx, options.parent) },
      callCtx,
    );
  }
  if (options.operation === "transform") {
    if (
      !options.parent ||
      !ctx.adapter.transform ||
      !ctx.adapter.capabilities.modes.includes("video-to-video")
    ) {
      throw new VideoError(`The "${ctx.adapter.name}" adapter does not support video transformation.`);
    }
    return ctx.adapter.transform(
      { ...request, source: await sourceBytes(ctx, options.parent) },
      callCtx,
    );
  }
  if (
    !ctx.adapter.capabilities.modes.includes("text-to-video") &&
    !ctx.adapter.capabilities.modes.includes("image-to-video")
  ) {
    throw new VideoError(`The "${ctx.adapter.name}" adapter cannot generate video.`);
  }
  return ctx.adapter.generate(request, callCtx);
}

async function generateFromDraft(
  ctx: ToolContext,
  draft: VideoPromptDraft,
  options: GenerationOptions,
  signal?: AbortSignal,
): Promise<GenerationOutcome> {
  const usage = emptyVideoUsage();
  const pipeline = [
    ...ctx.pipeline.filter((enhancer) => enhancer.name !== "fit-to-model"),
    fitVideoToModel(),
  ];
  const finalDraft = await runVideoPipeline(draft, pipeline, {
    library: ctx.library,
    assets: ctx.assets,
    model: ctx.model,
    capabilities: ctx.adapter.capabilities,
    recordUsage: (value) => recordUsage(ctx, "enhance", value, usage),
    signal,
  });
  const result = await invokeAdapter(ctx, finalDraft, options, signal);
  const source: VideoUsageSource = options.operation;
  recordUsage(
    ctx,
    source,
    result.usage ?? {
      requests: 1,
      seconds_generated: result.videos.reduce(
        (sum, video) => sum + (video.duration ?? finalDraft.params.duration ?? 0),
        0,
      ),
    },
    usage,
  );

  const recipeKind: VideoRecipe["kind"] = options.flow
    ? "flow-shot"
    : options.operation === "extend"
      ? "extended"
      : options.operation === "transform"
        ? "transformed"
        : "generated";
  const recipe: VideoRecipe = {
    kind: recipeKind,
    intent: finalDraft.intent,
    finalPrompt: finalDraft.prompt,
    negative: finalDraft.negative,
    beats: finalDraft.beats.length ? finalDraft.beats : undefined,
    params: finalDraft.params,
    adapter: ctx.adapter.name,
    characters: finalDraft.requested.characters.length
      ? finalDraft.requested.characters
      : undefined,
    scene: finalDraft.requested.scene,
    refs: finalDraft.refs.map((ref) => ({ asset: ref.asset, role: ref.role })),
    trace: finalDraft.trace,
    parent: options.parent,
    flow: options.flow,
    usage,
  };
  const stored: VideoAsset[] = [];
  for (const video of result.videos) {
    stored.push(
      await ctx.assets.put(video.bytes, {
        name: options.name,
        mime: video.mime,
        width: video.width ?? 0,
        height: video.height ?? 0,
        duration: video.duration ?? finalDraft.params.duration ?? 0,
        fps: video.fps ?? finalDraft.params.fps,
        // Requested audio is not proof that the downloaded file has (or lacks)
        // an audio track. Adapters should set this only when they know.
        has_audio: video.has_audio,
        source: options.flow
          ? "flow"
          : options.operation === "extend"
            ? "extended"
            : options.operation === "transform"
              ? "transformed"
              : "generated",
        recipe,
        tags: options.tags,
      }),
    );
  }
  if (stored.length === 0) throw new VideoError("Video adapter returned no videos.");
  return {
    assets: stored,
    finalPrompt: finalDraft.prompt,
    degradations: degradations(finalDraft),
    revised_prompt: result.revised_prompt,
    provider_job_ids: result.provider_job_ids,
    usage,
  };
}

async function outcomeResult(
  ctx: ToolContext,
  outcome: GenerationOutcome,
  extra: Record<string, unknown> = {},
): Promise<ToolResultData> {
  const base: ToolResultData = {
    status: "success",
    data: {
      assets: outcome.assets.map(assetSummary),
      degradations: outcome.degradations,
      revised_prompt: outcome.revised_prompt,
      provider_job_ids: outcome.provider_job_ids,
      usage: outcome.usage,
      ...(ctx.review
        ? {
            review_required: true,
            approved: false,
            next_action: "Inspect every candidate with glove_video_review; revise failures and use glove_video_deliver only for a passing candidate.",
          }
        : {}),
      ...extra,
    },
  };
  // Reviewed workflows keep drafts off the user-facing display. The explicit
  // deliver tool is the only path that renders an approved clip.
  if (!ctx.review) {
    base.renderData = {
      kind: "video-gallery",
      videos: await Promise.all(outcome.assets.map((asset) => playableSummary(ctx, asset))),
    };
  }
  return base;
}

const VideoRefRoleSchema = z.enum([
  "first-frame",
  "last-frame",
  "identity",
  "style",
  "motion",
  "source",
  "continuity",
]);

const VideoRefSchema = z.object({
  asset: z.string().describe("Image or video asset id understood by the reference resolver."),
  role: VideoRefRoleSchema.describe("How the model should use this reference."),
  weight: z.number().min(0).max(1).optional(),
});

const VideoBeatSchema = z.object({
  at: z.number().min(0).describe("Seconds from the beginning of the clip."),
  action: z.string().min(1).describe("Visible action that should happen at this time."),
});

const VideoParamsSchema = z.object({
  duration: z.number().positive().optional().describe("Requested duration in seconds."),
  aspect_ratio: z.string().optional().describe('Aspect ratio, e.g. "16:9" or "9:16".'),
  resolution: z.string().optional().describe('Provider resolution label, e.g. "720p".'),
  fps: z.number().positive().optional(),
  seed: z.number().int().optional(),
  candidates: z.number().int().min(1).max(8).optional(),
  audio: z.boolean().optional().describe("Request generated or synchronized audio."),
});

const GenerateSchema = z.object({
  intent: z.string().min(1).describe("The visible action and outcome for this clip."),
  characters: z.array(z.string()).optional(),
  scene: z.string().optional(),
  refs: z.array(VideoRefSchema).optional(),
  beats: z.array(VideoBeatSchema).optional(),
  negative: z.string().optional(),
  ...VideoParamsSchema.shape,
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
type GenerateInput = z.infer<typeof GenerateSchema>;

const DerivedSchema = GenerateSchema.omit({ intent: true }).extend({
  asset: z.string().describe("Source video asset id."),
  instruction: z.string().min(1).describe("How to continue or transform the source clip."),
});
type DerivedInput = z.infer<typeof DerivedSchema>;

const RegenerateSchema = z.object({
  asset: z.string(),
  tweak: z.string().optional(),
});
type RegenerateInput = z.infer<typeof RegenerateSchema>;

const ImportSchema = z.object({
  url: z.string().optional().describe("HTTP(S) or data URL."),
  data: z.string().optional().describe("Raw base64 bytes without a data URL prefix."),
  mime: z.string().optional(),
  width: z.number().int().min(0).default(0),
  height: z.number().int().min(0).default(0),
  duration: z.number().min(0).describe("Duration in seconds."),
  fps: z.number().positive().optional(),
  has_audio: z.boolean().optional(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
type ImportInput = z.infer<typeof ImportSchema>;

const AssetListSchema = z.object({
  source: z.enum(["imported", "generated", "extended", "transformed", "flow"]).optional(),
  tags: z.array(z.string()).optional(),
  name_contains: z.string().optional(),
});
type AssetListInput = z.infer<typeof AssetListSchema>;

const AssetSchema = z.object({ asset: z.string() });
type AssetInput = z.infer<typeof AssetSchema>;

const ReviewInputSchema = z.object({
  asset: z.string().describe("Video asset id to inspect."),
  brief: z.string().min(1).optional().describe("The intended viewer experience and required content. Defaults to the generation intent."),
  rubric: z.string().min(1).optional().describe("Optional acceptance criteria for this review."),
  reference_assets: z.array(z.string()).max(6).optional().describe(
    "Optional image asset ids the reviewer must compare against for identity, product, wardrobe, or style continuity.",
  ),
});
type ReviewInput = z.infer<typeof ReviewInputSchema>;

const ReviewResponseSchema = z.object({
  decision: z.enum(["pass", "revise"]),
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  issues: z.array(z.object({
    criterion: z.string().min(1),
    severity: z.enum(["minor", "major", "critical"]),
    evidence: z.string().min(1),
    fix: z.string().min(1),
  })).default([]),
  revision_prompt: z.string().optional(),
});

const CharacterSaveSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  display_name: z.string().optional(),
  appearance: z.string().min(10),
  performance: z.string().optional(),
  negative: z.string().optional(),
  refs: z
    .array(z.object({ asset: z.string(), role: z.enum(["identity", "motion"]), label: z.string().optional() }))
    .optional(),
  tags: z.array(z.string()).optional(),
});
type CharacterSaveInput = z.infer<typeof CharacterSaveSchema>;

const SceneSaveSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  display_name: z.string().optional(),
  setting: z.string().min(10),
  ambient_motion: z.string().optional(),
  negative: z.string().optional(),
  refs: z
    .array(z.object({ asset: z.string(), role: z.enum(["style", "continuity"]), label: z.string().optional() }))
    .optional(),
  tags: z.array(z.string()).optional(),
});
type SceneSaveInput = z.infer<typeof SceneSaveSchema>;

const NameSchema = z.object({ name: z.string() });
type NameInput = z.infer<typeof NameSchema>;
const ListSchema = z.object({ tags: z.array(z.string()).optional(), name_contains: z.string().optional() });
type ListInput = z.infer<typeof ListSchema>;

const FlowShotSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  intent: z.string().min(1),
  characters: z.array(z.string()).optional(),
  scene: z.string().optional(),
  refs: z.array(VideoRefSchema).optional(),
  beats: z.array(VideoBeatSchema).optional(),
  negative: z.string().optional(),
  params: VideoParamsSchema.optional(),
  depends_on: z.array(z.string()).optional(),
  continuity: z
    .object({ from: z.string(), mode: z.enum(["reference", "extend"]) })
    .optional(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const FlowSaveSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().optional(),
  shots: z.array(FlowShotSchema).min(1),
  tags: z.array(z.string()).optional(),
});
type FlowSaveInput = z.infer<typeof FlowSaveSchema>;

const FlowRunSchema = z.object({ name: z.string() });
type FlowRunInput = z.infer<typeof FlowRunSchema>;
const FlowResumeSchema = z.object({ run: z.string() });
type FlowResumeInput = z.infer<typeof FlowResumeSchema>;
const FlowStatusSchema = z.object({ run: z.string() });
type FlowStatusInput = z.infer<typeof FlowStatusSchema>;
const FlowDeliverSchema = z.object({
  run: z.string(),
  replacements: z.array(z.object({
    shot: z.string(),
    asset: z.string(),
  })).optional(),
});
type FlowDeliverInput = z.infer<typeof FlowDeliverSchema>;

function draftFromInput(input: GenerateInput): VideoPromptDraft {
  return createVideoDraft({
    intent: input.intent,
    characters: input.characters,
    scene: input.scene,
    refs: input.refs as VideoReference[] | undefined,
    beats: input.beats,
    negative: input.negative,
    params: {
      duration: input.duration,
      aspectRatio: input.aspect_ratio,
      resolution: input.resolution,
      fps: input.fps,
      seed: input.seed,
      candidates: input.candidates,
      audio: input.audio,
    },
  });
}

export function buildVideoGenerateTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<GenerateInput> {
  return {
    name: "glove_video_generate",
    description:
      "Generate video clips from a plain-language intent, optional timed beats, reusable " +
      "characters/scenes, and image or video references. Returns durable draft asset ids; " +
      "when review is enabled, inspect them before delivery.",
    inputSchema: GenerateSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal) {
      try {
        const normalized = { ...input, candidates: input.candidates ?? ctx.defaultCandidates };
        const outcome = await generateFromDraft(
          ctx,
          draftFromInput(normalized),
          { operation: "generate", name: input.name, tags: input.tags },
          signal,
        );
        return outcomeResult(ctx, outcome);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function buildDerivedTool(
  ctx: ToolContext,
  operation: "extend" | "transform",
  requirePermission: boolean,
): GloveFoldArgs<DerivedInput> {
  const verb = operation === "extend" ? "Continue a video beyond its ending" : "Transform an existing video";
  return {
    name: `glove_video_${operation}`,
    description: `${verb} while preserving lineage to the source asset.`,
    inputSchema: DerivedSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal) {
      try {
        const outcome = await generateFromDraft(
          ctx,
          createVideoDraft({
            intent: input.instruction,
            characters: input.characters,
            scene: input.scene,
            refs: input.refs as VideoReference[] | undefined,
            beats: input.beats,
            negative: input.negative,
            params: {
              duration: input.duration,
              aspectRatio: input.aspect_ratio,
              resolution: input.resolution,
              fps: input.fps,
              seed: input.seed,
              candidates: input.candidates ?? ctx.defaultCandidates,
              audio: input.audio,
            },
          }),
          { operation, parent: input.asset, name: input.name, tags: input.tags },
          signal,
        );
        return outcomeResult(ctx, outcome, { parent: input.asset });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoExtendTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<DerivedInput> {
  return buildDerivedTool(ctx, "extend", requirePermission);
}

export function buildVideoTransformTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<DerivedInput> {
  return buildDerivedTool(ctx, "transform", requirePermission);
}

export function buildVideoRegenerateTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<RegenerateInput> {
  return {
    name: "glove_video_regenerate",
    description: "Replay a generated video's recipe through the current prompt pipeline, with an optional tweak.",
    inputSchema: RegenerateSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal) {
      try {
        const asset = await ctx.assets.get(input.asset);
        if (!asset) return errorResult(`Video asset "${input.asset}" not found`);
        const recipe = asset.recipe;
        if (!recipe || (recipe.kind !== "generated" && recipe.kind !== "flow-shot")) {
          return errorResult(`Video asset "${input.asset}" has no replayable generation recipe.`);
        }
        const outcome = await generateFromDraft(
          ctx,
          createVideoDraft({
            intent: input.tweak ? `${recipe.intent}. ${input.tweak}` : recipe.intent,
            characters: recipe.characters,
            scene: recipe.scene,
            refs: recipe.refs as VideoReference[] | undefined,
            beats: recipe.beats,
            negative: recipe.negative,
            params: recipe.params,
          }),
          { operation: "generate", name: asset.name, tags: asset.tags },
          signal,
        );
        return outcomeResult(ctx, outcome, { regenerated_from: input.asset });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoImportTool(ctx: ToolContext): GloveFoldArgs<ImportInput> {
  return {
    name: "glove_video_import",
    description: "Import a video from an HTTP(S) URL, data URL, or raw base64 into the video asset store.",
    inputSchema: ImportSchema,
    async do(input, _display, _glove, signal) {
      try {
        if (Boolean(input.url) === Boolean(input.data)) {
          return errorResult("Provide exactly one of url or data.");
        }
        let bytes: Uint8Array;
        let mime = input.mime;
        if (input.url?.startsWith("data:")) {
          const decoded = videoFromDataUrl(input.url);
          bytes = decoded.bytes;
          mime = decoded.mime;
        } else if (input.url) {
          const response = await fetch(input.url, { signal: signal ?? null });
          if (!response.ok) return errorResult(`Fetch failed: ${response.status} ${response.statusText}`);
          bytes = new Uint8Array(await response.arrayBuffer());
          mime = mime ?? response.headers.get("content-type")?.split(";")[0] ?? undefined;
        } else {
          bytes = new Uint8Array(Buffer.from(input.data!, "base64"));
        }
        if (!mime?.startsWith("video/")) {
          return errorResult("A video mime type is required (for example video/mp4).");
        }
        const asset = await ctx.assets.put(bytes, {
          name: input.name,
          mime,
          width: input.width,
          height: input.height,
          duration: input.duration,
          fps: input.fps,
          has_audio: input.has_audio,
          source: "imported",
          tags: input.tags,
        });
        const result: ToolResultData = {
          status: "success",
          data: {
            ...assetSummary(asset),
            ...(ctx.review
              ? {
                  review_required: true,
                  approved: false,
                  next_action: "Inspect this video with glove_video_review before delivery.",
                }
              : {}),
          },
        };
        if (!ctx.review) {
          result.renderData = { kind: "video-gallery", videos: [await playableSummary(ctx, asset)] };
        }
        return result;
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoAssetGetTool(ctx: ToolContext): GloveFoldArgs<AssetInput> {
  return {
    name: "glove_video_asset_get",
    description: "Get video metadata and generation lineage without loading bytes into model context.",
    inputSchema: AssetSchema,
    async do(input) {
      const asset = await ctx.assets.get(input.asset);
      if (!asset) return errorResult(`Video asset "${input.asset}" not found`);
      const state = await reviewState(ctx, asset.id);
      const result: ToolResultData = {
        status: "success",
        data: { ...assetSummary(asset), created_at: asset.created_at, recipe: asset.recipe, ...state },
      };
      if (state.approved) {
        result.renderData = { kind: "video", video: await playableSummary(ctx, asset) };
      }
      return result;
    },
  };
}

function parseReviewResponse(text: string): z.infer<typeof ReviewResponseSchema> {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) throw new VideoError("Reviewer did not return a JSON object.");
  const raw = JSON.parse(unfenced.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof raw.decision === "string") raw.decision = raw.decision.toLowerCase();
  return ReviewResponseSchema.parse(raw);
}

function reviewInstruction(
  asset: VideoAsset,
  brief: string,
  rubric: string | undefined,
  passingScore: number,
): string {
  return [
    "You are the final quality-control reviewer for a generated video.",
    "Watch the actual clip from beginning to end. Do not infer quality from the filename, prompt, or metadata.",
    `Creative brief: ${brief}`,
    asset.recipe?.finalPrompt ? `Generation prompt: ${asset.recipe.finalPrompt}` : "",
    `Clip metadata: ${asset.duration}s, ${asset.width}x${asset.height}, audio=${String(asset.has_audio ?? "unknown")}.`,
    rubric ? `Additional rubric: ${rubric}` : "",
    "Evaluate: brief adherence, subject and anatomy consistency, temporal coherence, motion physics, composition/camera work, artifacts/flicker/morphing, pacing, and audio when requested.",
    asset.recipe?.refs?.some((ref) => ref.role === "identity" || ref.role === "style")
      ? "Reference images follow in the message. Compare the clip directly against them for face, hair, body, wardrobe, product, palette, and style continuity."
      : "",
    `A pass requires a score of at least ${passingScore} and no major or critical issue. Be demanding: this is the last gate before a human sees it.`,
    "Return only one JSON object with this exact shape:",
    '{"decision":"pass|revise","score":0,"summary":"...","strengths":["..."],"issues":[{"criterion":"...","severity":"minor|major|critical","evidence":"specific timestamp or symptom","fix":"actionable change"}],"revision_prompt":"a self-contained generation instruction that fixes every issue"}',
  ].filter(Boolean).join("\n");
}

export function buildVideoReviewTool(ctx: ToolContext): GloveFoldArgs<ReviewInput> {
  return {
    name: "glove_video_review",
    description:
      "Watch the actual stored video and judge it against the creative brief. Returns evidence, " +
      "a pass/revise decision, and a ready-to-use revision prompt. Required before delivery when enabled.",
    inputSchema: ReviewInputSchema,
    async do(input, _display, _glove, signal) {
      try {
        if (!ctx.review) return errorResult("Video review is not configured.");
        const asset = await ctx.assets.get(input.asset);
        if (!asset) return errorResult(`Video asset "${input.asset}" not found`);
        const brief = input.brief ?? asset.recipe?.intent;
        if (!brief) return errorResult("A creative brief is required to review an imported video.");
        const rubric = input.rubric ?? ctx.review.rubric;
        const instruction = reviewInstruction(asset, brief, rubric, ctx.review.passingScore);
        const referenceContent: ContentPart[] = [];
        const reviewRefs: VideoReference[] = [...(asset.recipe?.refs ?? [])];
        for (const asset of input.reference_assets ?? []) {
          if (!reviewRefs.some((ref) => ref.asset === asset)) {
            reviewRefs.push({ asset, role: "identity" });
          }
        }
        for (const ref of reviewRefs) {
          if (ref.role !== "identity" && ref.role !== "style" && ref.role !== "first-frame") continue;
          const resolved = await ctx.resolveReference(ref);
          if (!resolved.mime.startsWith("image/")) continue;
          referenceContent.push({
            type: "text",
            text: `Visual reference (${ref.role}) for the intended subject or look:`,
          });
          referenceContent.push({
            type: "image",
            source: {
              type: "base64",
              media_type: resolved.mime,
              data: Buffer.from(resolved.bytes).toString("base64"),
            },
          });
        }
        const result = await ctx.review.model.prompt(
          {
            messages: [{
              sender: "user",
              text: instruction,
              content: [
                { type: "text", text: instruction },
                ...referenceContent,
                {
                  type: "video",
                  source: {
                    type: "base64",
                    media_type: asset.mime,
                    data: Buffer.from(await ctx.assets.bytes(asset.id)).toString("base64"),
                  },
                },
              ],
            }],
          },
          noopNotify,
          signal,
        );
        const usage = addVideoUsage(emptyVideoUsage(), {
          requests: 1,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
        });
        recordUsage(ctx, "review", usage);
        const text = result.messages.at(-1)?.text?.trim() ?? "";
        const parsed = parseReviewResponse(text);
        const hasBlockingIssue = parsed.issues.some(
          (issue) => issue.severity === "major" || issue.severity === "critical",
        );
        const approved = parsed.decision === "pass" &&
          parsed.score >= ctx.review.passingScore &&
          !hasBlockingIssue;
        const issues: VideoReviewIssue[] = parsed.issues;
        const revisionPrompt = approved
          ? undefined
          : parsed.revision_prompt ?? (issues.map((issue) => issue.fix).join(" ") || parsed.summary);
        const review: VideoReview = {
          id: generateVideoReviewId(),
          asset: asset.id,
          decision: approved ? "pass" : "revise",
          score: parsed.score,
          brief,
          rubric,
          summary: parsed.summary,
          strengths: parsed.strengths,
          issues,
          revision_prompt: revisionPrompt,
          reviewer: ctx.review.model.name,
          created_at: videoNowIso(),
          usage,
          ...(input.reference_assets?.length
            ? { reference_assets: [...input.reference_assets] }
            : {}),
        };
        await ctx.review.store.save(review);
        return {
          status: "success",
          data: {
            review,
            approved,
            can_deliver: approved,
            next_action: approved
              ? "Select this candidate with glove_video_deliver."
              : "Regenerate or transform using review.revision_prompt, then review the new asset.",
          },
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoDeliverTool(ctx: ToolContext): GloveFoldArgs<AssetInput> {
  return {
    name: "glove_video_deliver",
    description:
      "Reveal exactly one final video to the user. Refuses drafts unless their latest actual-video review passed.",
    inputSchema: AssetSchema,
    async do(input) {
      if (!ctx.review) return errorResult("Video review is not configured.");
      const asset = await ctx.assets.get(input.asset);
      if (!asset) return errorResult(`Video asset "${input.asset}" not found`);
      const latest = await ctx.review.store.latest(asset.id);
      if (!latest || latest.decision !== "pass") {
        return errorResult(
          latest
            ? `Video asset "${asset.id}" did not pass its latest review. Revise and review the new draft.`
            : `Video asset "${asset.id}" has not been reviewed. Call glove_video_review first.`,
        );
      }
      return {
        status: "success",
        data: {
          ...assetSummary(asset),
          approved: true,
          review: latest,
          message: "Approved video selected for delivery.",
        },
        renderData: { kind: "video", video: await playableSummary(ctx, asset) },
      };
    },
  };
}

export function buildVideoAssetListTool(ctx: ToolContext): GloveFoldArgs<AssetListInput> {
  return {
    name: "glove_video_asset_list",
    description: "List video asset ids and metadata. Video bytes never enter model context.",
    inputSchema: AssetListSchema,
    async do(input) {
      const assets = await ctx.assets.list(input);
      return { status: "success", data: { count: assets.length, assets: assets.map(assetSummary) } };
    },
  };
}

export function buildVideoUsageTool(ctx: ToolContext): GloveFoldArgs<Record<string, never>> {
  return {
    name: "glove_video_usage",
    description: "Report video workflow requests, tokens, generated seconds, and provider cost for this session.",
    inputSchema: z.object({}),
    async do() {
      return { status: "success", data: ctx.meter.report() };
    },
  };
}

export function buildVideoCharacterSaveTool(
  ctx: ToolContext,
): GloveFoldArgs<CharacterSaveInput> {
  return {
    name: "glove_video_character_save",
    description: "Save canonical character appearance, performance direction, and identity/motion references.",
    inputSchema: CharacterSaveSchema,
    async do(input) {
      const existing = await ctx.library.getCharacter(input.name);
      const def: VideoCharacterDef = {
        ...input,
        created_at: existing?.created_at ?? videoNowIso(),
        updated_at: videoNowIso(),
      };
      await ctx.library.saveCharacter(def);
      return { status: "success", data: { saved: input.name, updated: Boolean(existing) } };
    },
  };
}

export function buildVideoSceneSaveTool(ctx: ToolContext): GloveFoldArgs<SceneSaveInput> {
  return {
    name: "glove_video_scene_save",
    description: "Save a reusable scene with canonical setting and ambient-motion direction.",
    inputSchema: SceneSaveSchema,
    async do(input) {
      const existing = await ctx.library.getScene(input.name);
      const def: VideoSceneDef = {
        ...input,
        created_at: existing?.created_at ?? videoNowIso(),
        updated_at: videoNowIso(),
      };
      await ctx.library.saveScene(def);
      return { status: "success", data: { saved: input.name, updated: Boolean(existing) } };
    },
  };
}

function buildLibraryGetTool(
  ctx: ToolContext,
  kind: "character" | "scene",
): GloveFoldArgs<NameInput> {
  return {
    name: `glove_video_${kind}_get`,
    description: `Get a reusable video ${kind} definition.`,
    inputSchema: NameSchema,
    async do(input) {
      const value = kind === "character"
        ? await ctx.library.getCharacter(input.name)
        : await ctx.library.getScene(input.name);
      return value ? { status: "success", data: value } : errorResult(`${kind} "${input.name}" not found.`);
    },
  };
}

function buildLibraryListTool(
  ctx: ToolContext,
  kind: "character" | "scene",
): GloveFoldArgs<ListInput> {
  return {
    name: `glove_video_${kind}_list`,
    description: `List reusable video ${kind}s.`,
    inputSchema: ListSchema,
    async do(input) {
      const values = kind === "character"
        ? await ctx.library.listCharacters(input)
        : await ctx.library.listScenes(input);
      return { status: "success", data: { count: values.length, [`${kind}s`]: values } };
    },
  };
}

function buildLibraryRemoveTool(
  ctx: ToolContext,
  kind: "character" | "scene",
): GloveFoldArgs<NameInput> {
  return {
    name: `glove_video_${kind}_remove`,
    description: `Remove a reusable video ${kind}.`,
    inputSchema: NameSchema,
    async do(input) {
      if (kind === "character") await ctx.library.removeCharacter(input.name);
      else await ctx.library.removeScene(input.name);
      return { status: "success", data: { removed: input.name } };
    },
  };
}

function flowRunSummary(run: VideoFlowRun): Record<string, unknown> {
  return {
    id: run.id,
    flow: run.flow,
    status: run.status,
    shots: run.shots,
    created_at: run.created_at,
    started_at: run.started_at,
    completed_at: run.completed_at,
    error: run.error,
  };
}

function flowDefinition(input: FlowSaveInput, existing?: VideoFlowDefinition | null): VideoFlowDefinition {
  return {
    name: input.name,
    description: input.description,
    shots: input.shots.map((shot) => ({
      ...shot,
      refs: shot.refs as VideoReference[] | undefined,
      params: shot.params
        ? {
            duration: shot.params.duration,
            aspectRatio: shot.params.aspect_ratio,
            resolution: shot.params.resolution,
            fps: shot.params.fps,
            seed: shot.params.seed,
            candidates: shot.params.candidates,
            audio: shot.params.audio,
          }
        : undefined,
    })),
    tags: input.tags,
    created_at: existing?.created_at ?? videoNowIso(),
    updated_at: videoNowIso(),
  };
}

export function buildVideoFlowSaveTool(ctx: ToolContext): GloveFoldArgs<FlowSaveInput> {
  return {
    name: "glove_video_flow_save",
    description:
      "Create or update a resumable multi-shot video flow. Dependencies order shots; continuity can " +
      "reference or extend an earlier shot. The definition is validated for missing shots and cycles.",
    inputSchema: FlowSaveSchema,
    async do(input) {
      try {
        const existing = await ctx.flows.getFlow(input.name);
        const flow = flowDefinition(input, existing);
        validateVideoFlow(flow);
        await ctx.flows.saveFlow(flow);
        return { status: "success", data: { saved: flow.name, updated: Boolean(existing), shots: flow.shots.length } };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoFlowGetTool(ctx: ToolContext): GloveFoldArgs<NameInput> {
  return {
    name: "glove_video_flow_get",
    description: "Get a multi-shot video flow definition.",
    inputSchema: NameSchema,
    async do(input) {
      const flow = await ctx.flows.getFlow(input.name);
      return flow ? { status: "success", data: flow } : errorResult(`Video flow "${input.name}" not found.`);
    },
  };
}

export function buildVideoFlowListTool(ctx: ToolContext): GloveFoldArgs<ListInput> {
  return {
    name: "glove_video_flow_list",
    description: "List saved video flow definitions and recent run counts.",
    inputSchema: ListSchema,
    async do(input) {
      const flows = await ctx.flows.listFlows(input);
      const rows = await Promise.all(
        flows.map(async (flow) => ({
          name: flow.name,
          description: flow.description,
          shots: flow.shots.length,
          tags: flow.tags,
          runs: (await ctx.flows.listRuns(flow.name)).length,
        })),
      );
      return { status: "success", data: { count: rows.length, flows: rows } };
    },
  };
}

export function buildVideoFlowRemoveTool(ctx: ToolContext): GloveFoldArgs<NameInput> {
  return {
    name: "glove_video_flow_remove",
    description: "Remove a saved flow definition. Existing run snapshots remain resumable.",
    inputSchema: NameSchema,
    async do(input) {
      await ctx.flows.removeFlow(input.name);
      return { status: "success", data: { removed: input.name } };
    },
  };
}

async function generateFlowShot(
  ctx: ToolContext,
  shot: VideoFlowShot,
  run: VideoFlowRun,
  continuityAsset: string | undefined,
  signal?: AbortSignal,
): Promise<VideoAsset[]> {
  const refs = [...(shot.refs ?? [])];
  let operation: GenerationOptions["operation"] = "generate";
  let parent: string | undefined;
  if (shot.continuity?.mode === "extend") {
    operation = "extend";
    parent = continuityAsset;
  } else if (shot.continuity?.mode === "reference" && continuityAsset) {
    refs.push({ asset: continuityAsset, role: "continuity" });
  }
  const outcome = await generateFromDraft(
    ctx,
    createVideoDraft({
      intent: shot.intent,
      characters: shot.characters,
      scene: shot.scene,
      refs,
      beats: shot.beats,
      negative: shot.negative,
      params: { ...shot.params, candidates: shot.params?.candidates ?? ctx.defaultCandidates },
    }),
    {
      operation,
      parent,
      name: shot.name ?? `${run.flow}-${shot.id}`,
      tags: shot.tags,
      flow: { run: run.id, shot: shot.id },
    },
    signal,
  );
  return outcome.assets;
}

async function executeFlow(
  ctx: ToolContext,
  flow: VideoFlowDefinition,
  runId: string | undefined,
  signal?: AbortSignal,
): Promise<VideoFlowRun> {
  return runVideoFlow(
    flow,
    ctx.flows,
    (shot, runCtx) =>
      generateFlowShot(ctx, shot, runCtx.run, runCtx.continuityAsset, runCtx.signal),
    { runId, signal },
  );
}

export function buildVideoFlowRunTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<FlowRunInput> {
  return {
    name: "glove_video_flow_run",
    description:
      "Run a saved multi-shot flow. Progress is checkpointed around every shot; failed runs can be resumed.",
    inputSchema: FlowRunSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal) {
      try {
        const flow = await ctx.flows.getFlow(input.name);
        if (!flow) return errorResult(`Video flow "${input.name}" not found.`);
        const run = await executeFlow(ctx, flow, undefined, signal);
        return {
          status: run.status === "succeeded" ? "success" : "error",
          data: flowRunSummary(run),
          ...(run.error ? { message: run.error } : {}),
          renderData: { kind: "video-flow", run: flowRunSummary(run) },
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoFlowResumeTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<FlowResumeInput> {
  return {
    name: "glove_video_flow_resume",
    description: "Resume a failed or interrupted flow run from its last successful shot.",
    inputSchema: FlowResumeSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal) {
      try {
        const existing = await ctx.flows.getRun(input.run);
        if (!existing) return errorResult(`Video flow run "${input.run}" not found.`);
        const run = await executeFlow(ctx, existing.definition, input.run, signal);
        return {
          status: run.status === "succeeded" ? "success" : "error",
          data: flowRunSummary(run),
          ...(run.error ? { message: run.error } : {}),
          renderData: { kind: "video-flow", run: flowRunSummary(run) },
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function buildVideoFlowStatusTool(ctx: ToolContext): GloveFoldArgs<FlowStatusInput> {
  return {
    name: "glove_video_flow_status",
    description: "Inspect a video flow run and the asset ids produced by each shot.",
    inputSchema: FlowStatusSchema,
    async do(input) {
      const run = await ctx.flows.getRun(input.run);
      return run ? { status: "success", data: flowRunSummary(run) } : errorResult(`Run "${input.run}" not found.`);
    },
  };
}

export function buildVideoFlowDeliverTool(ctx: ToolContext): GloveFoldArgs<FlowDeliverInput> {
  return {
    name: "glove_video_flow_deliver",
    description:
      "Reveal a complete multi-shot flow only after every selected shot has a latest passing actual-video review. " +
      "Optional replacements let a reviewed revision stand in for its original flow shot.",
    inputSchema: FlowDeliverSchema,
    async do(input) {
      if (!ctx.review) return errorResult("Video review is not configured.");
      const run = await ctx.flows.getRun(input.run);
      if (!run) return errorResult(`Run "${input.run}" not found.`);
      if (run.status !== "succeeded") {
        return errorResult(`Run "${run.id}" is ${run.status}; only succeeded flows can be delivered.`);
      }

      const knownShots = new Set(run.shots.map((shot) => shot.shot));
      const replacements = new Map<string, string>();
      for (const replacement of input.replacements ?? []) {
        if (!knownShots.has(replacement.shot)) {
          return errorResult(`Replacement names unknown shot "${replacement.shot}".`);
        }
        if (replacements.has(replacement.shot)) {
          return errorResult(`Replacement for shot "${replacement.shot}" was provided more than once.`);
        }
        replacements.set(replacement.shot, replacement.asset);
      }

      const selected: Array<{ shot: string; asset: VideoAsset; review: VideoReview }> = [];
      for (const shot of run.shots) {
        const assetId = replacements.get(shot.shot) ?? shot.assets.at(-1);
        if (!assetId) return errorResult(`Shot "${shot.shot}" has no generated asset.`);
        const asset = await ctx.assets.get(assetId);
        if (!asset) return errorResult(`Shot "${shot.shot}" references missing asset "${assetId}".`);
        const review = await ctx.review.store.latest(assetId);
        if (!review) {
          return errorResult(`Shot "${shot.shot}" asset "${assetId}" has not been reviewed.`);
        }
        if (review.decision !== "pass") {
          return errorResult(
            `Shot "${shot.shot}" asset "${assetId}" did not pass its latest review. Revise and review it before delivering the flow.`,
          );
        }
        selected.push({ shot: shot.shot, asset, review });
      }

      return {
        status: "success",
        data: {
          run: run.id,
          flow: run.flow,
          approved: true,
          shots: selected.map(({ shot, asset, review }) => ({
            shot,
            asset: assetSummary(asset),
            review,
          })),
          message: "Approved video flow selected for delivery.",
        },
        renderData: {
          kind: "video-gallery",
          videos: await Promise.all(selected.map(({ asset }) => playableSummary(ctx, asset))),
        },
      };
    },
  };
}

export async function mountVideo(
  glove: VideoMountTarget,
  config: MountVideoConfig,
): Promise<void> {
  const pipeline = config.pipeline ?? defaultVideoPipeline();
  const names = new Set<string>();
  for (const enhancer of pipeline) {
    if (names.has(enhancer.name)) {
      throw new VideoError(`Duplicate pipeline enhancer name: "${enhancer.name}"`);
    }
    names.add(enhancer.name);
  }
  const defaultResolver: VideoReferenceResolver = async (ref) => {
    const asset = await config.assets.get(ref.asset);
    if (!asset) throw new VideoError(`Reference asset "${ref.asset}" not found`);
    return { bytes: await config.assets.bytes(ref.asset), mime: asset.mime };
  };
  const ctx: ToolContext = {
    adapter: config.adapter,
    assets: config.assets,
    library: config.library,
    flows: config.flows,
    pipeline,
    model: config.model,
    defaultCandidates: Math.max(1, config.candidates ?? 1),
    review: config.review
      ? {
          model: config.review.model,
          store: config.review.store ?? new SessionVideoReviewStore(),
          rubric: config.review.rubric,
          passingScore: Math.min(100, Math.max(0, config.review.passingScore ?? 80)),
        }
      : undefined,
    meter: config.usage ?? new VideoUsageMeter(),
    onUsage: config.onUsage,
    resolveReference: config.resolveReference ?? defaultResolver,
    onProgress: config.onProgress,
  };
  const gate = config.requirePermission ?? false;

  glove.fold(buildVideoGenerateTool(ctx, gate));
  glove.fold(buildVideoExtendTool(ctx, gate));
  glove.fold(buildVideoTransformTool(ctx, gate));
  glove.fold(buildVideoRegenerateTool(ctx, gate));
  glove.fold(buildVideoImportTool(ctx));
  glove.fold(buildVideoAssetGetTool(ctx));
  glove.fold(buildVideoAssetListTool(ctx));
  glove.fold(buildVideoUsageTool(ctx));
  if (ctx.review) {
    glove.fold(buildVideoReviewTool(ctx));
    glove.fold(buildVideoDeliverTool(ctx));
    glove.fold(buildVideoFlowDeliverTool(ctx));
  }

  glove.fold(buildLibraryGetTool(ctx, "character"));
  glove.fold(buildLibraryListTool(ctx, "character"));
  glove.fold(buildLibraryGetTool(ctx, "scene"));
  glove.fold(buildLibraryListTool(ctx, "scene"));
  glove.fold(buildVideoFlowGetTool(ctx));
  glove.fold(buildVideoFlowListTool(ctx));
  glove.fold(buildVideoFlowStatusTool(ctx));
  glove.fold(buildVideoFlowRunTool(ctx, gate));
  glove.fold(buildVideoFlowResumeTool(ctx, gate));

  if (config.curate ?? true) {
    glove.fold(buildVideoCharacterSaveTool(ctx));
    glove.fold(buildLibraryRemoveTool(ctx, "character"));
    glove.fold(buildVideoSceneSaveTool(ctx));
    glove.fold(buildLibraryRemoveTool(ctx, "scene"));
    glove.fold(buildVideoFlowSaveTool(ctx));
    glove.fold(buildVideoFlowRemoveTool(ctx));
  }
}
