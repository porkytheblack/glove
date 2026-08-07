// The glove_image_* tool surface and mountImage — the canonical entry point.

import z from "zod";
import type {
  GloveFoldArgs,
  ModelAdapter,
  NotifySubscribersFunction,
  ToolResultData,
} from "glove-core";
import {
  type AssemblySpec,
  type CharacterDef,
  type ImageAsset,
  type ImageAssetStore,
  type ImageGenerateRequest,
  type ImageLibraryAdapter,
  type ImageModelAdapter,
  type Recipe,
  type RefImage,
  type RefRole,
  type ResolvedRef,
  type SceneDef,
  ImageError,
  fromDataUrl,
  nowIso,
  sniffImage,
  toDataUrl,
} from "../core/index";
import {
  type PromptDraft,
  type PromptEnhancer,
  createDraft,
  defaultPipeline,
  fitToModel,
  runPipeline,
} from "../pipeline/index";

const noopNotify: NotifySubscribersFunction = async () => {};

// ─── Mount config ──────────────────────────────────────────────────────────

/**
 * Loose target type — anything exposing `fold` for tool registration.
 * `IGloveRunnable` and `IGloveBuilder` both satisfy this, and minimal stubs
 * in tests do too.
 */
export type ImageMountTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
};

export interface ReviewConfig {
  /** A vision-capable ModelAdapter used to critique generations. */
  vision: ModelAdapter;
  /** Max refine rounds after the first generation. Default 0 (off). */
  rounds?: number;
  /** Extra rubric appended to the critique instruction. */
  rubric?: string;
}

export interface MountImageConfig {
  adapter: ImageModelAdapter;
  assets: ImageAssetStore;
  library: ImageLibraryAdapter;
  /**
   * The middle of the pipeline. Defaults to
   * [expandCharacters(), expandScenes()]. fitToModel() is always appended
   * whether or not you list it.
   */
  pipeline?: PromptEnhancer[];
  /** LLM slot handed to enhancers (llmEnhance). Usually the agent's model. */
  model?: ModelAdapter;
  /** Fold library write tools too. Default true. */
  curate?: boolean;
  /** Default candidate count per generation. Default 1. */
  candidates?: number;
  /** Vision review loop. Off unless configured with rounds > 0. */
  review?: ReviewConfig;
  /** Gate generate/edit/regenerate behind the permission flow. Default false. */
  requirePermission?: boolean;
}

interface ToolContext {
  adapter: ImageModelAdapter;
  assets: ImageAssetStore;
  library: ImageLibraryAdapter;
  pipeline: PromptEnhancer[];
  model?: ModelAdapter;
  defaultCandidates: number;
  review?: ReviewConfig;
}

// ─── Shared helpers ────────────────────────────────────────────────────────

function errorResult(message: string): ToolResultData {
  return { status: "error", data: null, message };
}

async function resolveRefs(
  ctx: ToolContext,
  refs: RefImage[],
): Promise<ResolvedRef[]> {
  const resolved: ResolvedRef[] = [];
  for (const ref of refs) {
    const meta = await ctx.assets.get(ref.asset);
    if (!meta) throw new ImageError(`Reference asset "${ref.asset}" not found`);
    resolved.push({ ...ref, bytes: await ctx.assets.bytes(ref.asset), mime: meta.mime });
  }
  return resolved;
}

function degradations(draft: PromptDraft): string[] {
  return draft.trace
    .filter((t) => t.note)
    .map((t) => `${t.enhancer}: ${t.note}`);
}

async function renderThumb(ctx: ToolContext, asset: ImageAsset): Promise<string> {
  const bytes = ctx.assets.thumbnail
    ? await ctx.assets.thumbnail(asset.id, 512)
    : await ctx.assets.bytes(asset.id);
  return toDataUrl(bytes, asset.mime);
}

function assetSummary(asset: ImageAsset): Record<string, unknown> {
  return {
    id: asset.id,
    name: asset.name,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    source: asset.source,
    tags: asset.tags,
  };
}

/** Run the vision critique. Returns null on PASS, the critique text on FAIL. */
async function critique(
  review: ReviewConfig,
  draft: PromptDraft,
  image: { bytes: Uint8Array; mime: string },
  signal?: AbortSignal,
): Promise<string | null> {
  const rubricLine = review.rubric ? `Rubric: ${review.rubric}` : "";
  const characterLines = draft.characters
    .map((c) => `- ${c.display_name ?? c.name}: ${c.appearance}`)
    .join("\n");
  const instruction = [
    "You are reviewing a generated image against its brief.",
    `Brief: ${draft.intent}`,
    characterLines ? `Characters that must match:\n${characterLines}` : "",
    rubricLine,
    "",
    'Reply with exactly "PASS" on the first line if the image satisfies the brief.',
    'Otherwise reply "FAIL" on the first line, then 1-3 short revision notes.',
  ]
    .filter(Boolean)
    .join("\n");

  const result = await review.vision.prompt(
    {
      messages: [
        {
          sender: "user",
          text: instruction,
          content: [
            { type: "text", text: instruction },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mime,
                data: Buffer.from(image.bytes).toString("base64"),
              },
            },
          ],
        },
      ],
    },
    noopNotify,
    signal,
  );
  const text = result.messages[result.messages.length - 1]?.text?.trim() ?? "";
  if (/^pass\b/i.test(text)) return null;
  return text.replace(/^fail\b[:\s]*/i, "").trim() || "Does not satisfy the brief.";
}

interface GenerationOutcome {
  assets: ImageAsset[];
  finalPrompt: string;
  degradations: string[];
  revised_prompt?: string;
  review_notes?: string[];
}

/**
 * The one generation path: run the pipeline, resolve refs, call the
 * adapter, optionally review-and-refine, store every candidate with its
 * recipe.
 */
async function generateFromDraft(
  ctx: ToolContext,
  draft: PromptDraft,
  opts: { name?: string; tags?: string[] },
  signal?: AbortSignal,
): Promise<GenerationOutcome> {
  const enhancers = [...ctx.pipeline.filter((e) => e.name !== "fit-to-model"), fitToModel()];
  let finalDraft = await runPipeline(draft, enhancers, {
    library: ctx.library,
    assets: ctx.assets,
    model: ctx.model,
    capabilities: ctx.adapter.capabilities,
    signal,
  });

  const reviewNotes: string[] = [];
  const maxRounds = ctx.review?.rounds ?? 0;
  let result = await callAdapter(ctx, finalDraft, signal);

  for (let round = 0; round < maxRounds; round++) {
    const first = result.images[0];
    if (!first || !ctx.review) break;
    const note = await critique(ctx.review, finalDraft, first, signal);
    if (note === null) break;
    reviewNotes.push(note);
    finalDraft.positive = `${finalDraft.positive}\n\nRevision notes (address these): ${note}`;
    finalDraft.trace.push({
      enhancer: "review",
      note,
      positive_after: finalDraft.positive,
    });
    result = await callAdapter(ctx, finalDraft, signal);
  }

  const recipeBase: Recipe = {
    kind: "generated",
    intent: finalDraft.intent,
    finalPrompt: finalDraft.positive,
    negative: finalDraft.negative,
    params: finalDraft.params,
    adapter: ctx.adapter.name,
    characters: finalDraft.requested.characters.length
      ? finalDraft.requested.characters
      : undefined,
    scene: finalDraft.requested.scene,
    refs: finalDraft.refs.map((r) => ({ asset: r.asset, role: r.role })),
    trace: finalDraft.trace,
  };

  const stored: ImageAsset[] = [];
  for (const image of result.images) {
    const sniffed = sniffImage(image.bytes);
    stored.push(
      await ctx.assets.put(image.bytes, {
        name: opts.name,
        mime: sniffed?.mime ?? image.mime,
        width: sniffed?.width ?? 0,
        height: sniffed?.height ?? 0,
        source: "generated",
        recipe: recipeBase,
        tags: opts.tags,
      }),
    );
  }

  return {
    assets: stored,
    finalPrompt: finalDraft.positive,
    degradations: degradations(finalDraft),
    revised_prompt: result.revised_prompt,
    review_notes: reviewNotes.length ? reviewNotes : undefined,
  };
}

async function callAdapter(
  ctx: ToolContext,
  draft: PromptDraft,
  signal?: AbortSignal,
) {
  const request: ImageGenerateRequest = {
    prompt: draft.positive,
    negative: draft.negative,
    refs: await resolveRefs(ctx, draft.refs),
    size: draft.params.size,
    seed: draft.params.seed,
    candidates: draft.params.candidates,
    extra: draft.params.extra,
  };
  return ctx.adapter.generate(request, signal);
}

// ─── Schemas ───────────────────────────────────────────────────────────────

const RefRoleSchema = z.enum(["identity", "style", "composition", "content", "mask"]);

const RefInputSchema = z.object({
  asset: z.string().describe("Image asset id to use as a reference."),
  role: RefRoleSchema.describe(
    "What the reference is for: identity (this likeness), style (this look), composition (this framing), content (img2img base), mask (edit region).",
  ),
  weight: z.number().min(0).max(1).optional().describe("Optional 0..1 influence weight."),
});

const GenerateSchema = z.object({
  intent: z.string().min(1).describe("What to draw, in plain language. The pipeline expands it."),
  characters: z
    .array(z.string())
    .optional()
    .describe("Library character names to include. Use glove_image_character_list to see them."),
  scene: z
    .string()
    .optional()
    .describe("Library scene name for the setting. Use glove_image_scene_list to see them."),
  refs: z.array(RefInputSchema).optional().describe("Reference images by asset id."),
  negative: z.string().optional().describe("Things to avoid, comma-separated."),
  size: z.string().optional().describe('Requested size as "WxH", e.g. "1024x1024".'),
  seed: z.number().int().optional().describe("Seed, if the model supports it."),
  candidates: z.number().int().min(1).max(8).optional().describe("How many candidates to generate."),
  name: z.string().optional().describe("Optional human label for the stored asset(s)."),
  tags: z.array(z.string()).optional().describe("Optional tags for the stored asset(s)."),
});
type GenerateInput = z.infer<typeof GenerateSchema>;

const EditSchema = z.object({
  asset: z.string().describe("Asset id of the image to edit."),
  instruction: z.string().min(1).describe("What to change, in plain language."),
  mask: z.string().optional().describe("Optional asset id of a mask image (white = editable)."),
  refs: z.array(RefInputSchema).optional().describe("Extra reference images."),
  name: z.string().optional().describe("Optional label for the edited result."),
});
type EditInput = z.infer<typeof EditSchema>;

const RegenerateSchema = z.object({
  asset: z.string().describe("Asset id of a generated image to regenerate."),
  tweak: z
    .string()
    .optional()
    .describe('Optional adjustment appended to the original intent, e.g. "at dusk".'),
});
type RegenerateInput = z.infer<typeof RegenerateSchema>;

const ImportSchema = z
  .object({
    url: z.string().optional().describe("http(s) or data: URL of the image to import."),
    data: z.string().optional().describe("Base64 image bytes (no data: prefix)."),
    mime: z.string().optional().describe("Mime type when passing raw base64 data."),
    name: z.string().optional().describe("Optional human label."),
    tags: z.array(z.string()).optional(),
  })
  .describe("Provide exactly one of url or data.");
type ImportInput = z.infer<typeof ImportSchema>;

const DescribeSchema = z.object({
  asset: z.string().describe("Asset id to describe."),
});
type DescribeInput = z.infer<typeof DescribeSchema>;

const AssetListSchema = z.object({
  source: z.enum(["imported", "generated", "edited", "assembled"]).optional(),
  tags: z.array(z.string()).optional(),
  name_contains: z.string().optional(),
});
type AssetListInput = z.infer<typeof AssetListSchema>;

const AssembleSchema = z.object({
  canvas: z.object({
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    background: z.string().optional().describe('CSS color, default "#ffffff".'),
  }),
  layers: z
    .array(
      z.object({
        asset: z.string().describe("Asset id to paint."),
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        fit: z.enum(["cover", "contain", "fill"]).optional(),
        rotate: z.number().optional(),
        opacity: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .describe("Painted in order, first at the bottom."),
  name: z.string().optional(),
});
type AssembleInput = z.infer<typeof AssembleSchema>;

const CharacterSaveSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case, e.g. mira or night-courier")
    .describe("Library key, kebab-case."),
  display_name: z.string().optional(),
  appearance: z
    .string()
    .min(10)
    .describe(
      "One-paragraph canonical appearance. Spliced VERBATIM into prompts — write it prompt-ready.",
    ),
  notes: z.string().optional().describe("Non-visual notes. Never sent to the image model."),
  negative: z.string().optional().describe('Character-specific negatives, e.g. "no goggles".'),
  ref_images: z
    .array(z.object({ asset: z.string(), label: z.string().optional() }))
    .optional()
    .describe("Identity anchor asset ids, best-first."),
  tags: z.array(z.string()).optional(),
});
type CharacterSaveInput = z.infer<typeof CharacterSaveSchema>;

const SceneSaveSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case, e.g. neon-market"),
  display_name: z.string().optional(),
  setting: z
    .string()
    .min(10)
    .describe(
      "Canonical setting block: location, era, palette, lighting, mood. Prompt-ready, spliced verbatim.",
    ),
  negative: z.string().optional(),
  ref_images: z
    .array(
      z.object({
        asset: z.string(),
        role: z.enum(["style", "composition"]),
        label: z.string().optional(),
      }),
    )
    .optional(),
  tags: z.array(z.string()).optional(),
});
type SceneSaveInput = z.infer<typeof SceneSaveSchema>;

const NameSchema = z.object({ name: z.string() });
type NameInput = z.infer<typeof NameSchema>;

const LibraryListSchema = z.object({
  tags: z.array(z.string()).optional(),
  name_contains: z.string().optional(),
});
type LibraryListInput = z.infer<typeof LibraryListSchema>;

// ─── Tool builders ─────────────────────────────────────────────────────────

export function buildGenerateTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<GenerateInput> {
  return {
    name: "glove_image_generate",
    description:
      "Generate image(s) from an intent. The intent runs through the prompt pipeline: " +
      "library characters/scenes are expanded into canonical wording and reference images, " +
      "then the request is fitted to the image model's capabilities. " +
      "Returns stored asset ids — refer to images by asset id afterwards.",
    inputSchema: GenerateSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const draft = createDraft({
          intent: input.intent,
          characters: input.characters,
          scene: input.scene,
          refs: input.refs as RefImage[] | undefined,
          negative: input.negative,
          params: {
            size: input.size,
            seed: input.seed,
            candidates: input.candidates ?? ctx.defaultCandidates,
          },
        });
        const outcome = await generateFromDraft(
          ctx,
          draft,
          { name: input.name, tags: input.tags },
          signal,
        );
        const thumbs = await Promise.all(
          outcome.assets.map((a) => renderThumb(ctx, a)),
        );
        return {
          status: "success",
          data: {
            assets: outcome.assets.map(assetSummary),
            degradations: outcome.degradations,
            review_notes: outcome.review_notes,
            revised_prompt: outcome.revised_prompt,
          },
          renderData: {
            kind: "gallery",
            images: outcome.assets.map((a, i) => ({ ...assetSummary(a), dataUrl: thumbs[i] })),
          },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export function buildEditTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<EditInput> {
  return {
    name: "glove_image_edit",
    description:
      "Edit an existing image asset with a plain-language instruction (inpaint, restyle, " +
      "add or remove elements). Optionally scope the edit with a mask asset. " +
      "The result is stored as a new asset whose recipe records the parent.",
    inputSchema: EditSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        if (!ctx.adapter.edit || !ctx.adapter.capabilities.modes.includes("edit")) {
          return errorResult(
            `The "${ctx.adapter.name}" adapter does not support editing.`,
          );
        }
        const baseMeta = await ctx.assets.get(input.asset);
        if (!baseMeta) return errorResult(`Asset "${input.asset}" not found`);
        const base = { bytes: await ctx.assets.bytes(input.asset), mime: baseMeta.mime };

        let mask: { bytes: Uint8Array; mime: string } | undefined;
        if (input.mask) {
          const maskMeta = await ctx.assets.get(input.mask);
          if (!maskMeta) return errorResult(`Mask asset "${input.mask}" not found`);
          mask = { bytes: await ctx.assets.bytes(input.mask), mime: maskMeta.mime };
        }

        const refs = await resolveRefs(ctx, (input.refs ?? []) as RefImage[]);
        const result = await ctx.adapter.edit(
          { prompt: input.instruction, base, mask, refs },
          signal,
        );

        const stored: ImageAsset[] = [];
        for (const image of result.images) {
          const sniffed = sniffImage(image.bytes);
          stored.push(
            await ctx.assets.put(image.bytes, {
              name: input.name,
              mime: sniffed?.mime ?? image.mime,
              width: sniffed?.width ?? 0,
              height: sniffed?.height ?? 0,
              source: "edited",
              recipe: {
                kind: "edited",
                finalPrompt: input.instruction,
                adapter: ctx.adapter.name,
                parent: input.asset,
                refs: (input.refs ?? []).map((r) => ({
                  asset: r.asset,
                  role: r.role as RefRole,
                })),
              },
            }),
          );
        }
        const thumbs = await Promise.all(stored.map((a) => renderThumb(ctx, a)));
        return {
          status: "success",
          data: { assets: stored.map(assetSummary), parent: input.asset },
          renderData: {
            kind: "gallery",
            images: stored.map((a, i) => ({ ...assetSummary(a), dataUrl: thumbs[i] })),
          },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export function buildRegenerateTool(
  ctx: ToolContext,
  requirePermission: boolean,
): GloveFoldArgs<RegenerateInput> {
  return {
    name: "glove_image_regenerate",
    description:
      "Replay a generated asset's recipe through the current pipeline, optionally with a " +
      'tweak appended to the original intent (e.g. "at dusk"). The canonical "same but ..." move.',
    inputSchema: RegenerateSchema,
    requiresPermission: requirePermission,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const meta = await ctx.assets.get(input.asset);
        if (!meta) return errorResult(`Asset "${input.asset}" not found`);
        const recipe = meta.recipe;
        if (!recipe || recipe.kind !== "generated" || !recipe.intent) {
          return errorResult(
            `Asset "${input.asset}" has no generation recipe to replay (source: ${meta.source}).`,
          );
        }
        const intent = input.tweak ? `${recipe.intent}. ${input.tweak}` : recipe.intent;
        const draft = createDraft({
          intent,
          characters: recipe.characters,
          scene: recipe.scene,
          refs: recipe.refs?.filter((r) => r.role !== "identity") as RefImage[] | undefined,
          negative: recipe.negative,
          params: { ...recipe.params },
        });
        const outcome = await generateFromDraft(ctx, draft, { name: meta.name }, signal);
        const thumbs = await Promise.all(outcome.assets.map((a) => renderThumb(ctx, a)));
        return {
          status: "success",
          data: {
            assets: outcome.assets.map(assetSummary),
            regenerated_from: input.asset,
            degradations: outcome.degradations,
          },
          renderData: {
            kind: "gallery",
            images: outcome.assets.map((a, i) => ({ ...assetSummary(a), dataUrl: thumbs[i] })),
          },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export function buildImportTool(ctx: ToolContext): GloveFoldArgs<ImportInput> {
  return {
    name: "glove_image_import",
    description:
      "Bring an external image into the asset store — from an http(s) URL, a data: URL, " +
      "or raw base64 bytes. The stored asset can then be used as a reference, edit base, " +
      "or assembly layer.",
    inputSchema: ImportSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        let bytes: Uint8Array;
        let mime = input.mime;
        if (input.url && input.data) {
          return errorResult("Provide exactly one of url or data, not both.");
        }
        if (input.url?.startsWith("data:")) {
          const decoded = fromDataUrl(input.url);
          bytes = decoded.bytes;
          mime = decoded.mime;
        } else if (input.url) {
          const res = await fetch(input.url, { signal: signal ?? null });
          if (!res.ok) {
            return errorResult(`Fetch failed: ${res.status} ${res.statusText}`);
          }
          bytes = new Uint8Array(await res.arrayBuffer());
          mime = mime ?? res.headers.get("content-type")?.split(";")[0] ?? undefined;
        } else if (input.data) {
          bytes = new Uint8Array(Buffer.from(input.data, "base64"));
        } else {
          return errorResult("Provide one of url or data.");
        }

        const sniffed = sniffImage(bytes);
        if (!sniffed && !mime) {
          return errorResult("Could not determine the image format — pass mime explicitly.");
        }
        const asset = await ctx.assets.put(bytes, {
          name: input.name,
          mime: sniffed?.mime ?? mime!,
          width: sniffed?.width ?? 0,
          height: sniffed?.height ?? 0,
          source: "imported",
          tags: input.tags,
        });
        return {
          status: "success",
          data: assetSummary(asset),
          renderData: { kind: "gallery", images: [{ ...assetSummary(asset), dataUrl: await renderThumb(ctx, asset) }] },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export function buildDescribeTool(ctx: ToolContext): GloveFoldArgs<DescribeInput> {
  return {
    name: "glove_image_describe",
    description:
      "Describe an asset without loading its bytes: metadata, lineage (how it was made), " +
      "and — when a vision model is configured — a one-paragraph visual description. " +
      'The context-safe way to "look at" an image.',
    inputSchema: DescribeSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const meta = await ctx.assets.get(input.asset);
        if (!meta) return errorResult(`Asset "${input.asset}" not found`);

        let visual: string | undefined;
        if (ctx.review?.vision) {
          const bytes = await ctx.assets.bytes(input.asset);
          const result = await ctx.review.vision.prompt(
            {
              messages: [
                {
                  sender: "user",
                  text: "Describe this image in one short paragraph.",
                  content: [
                    { type: "text", text: "Describe this image in one short paragraph." },
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: meta.mime,
                        data: Buffer.from(bytes).toString("base64"),
                      },
                    },
                  ],
                },
              ],
            },
            noopNotify,
            signal,
          );
          visual = result.messages[result.messages.length - 1]?.text?.trim();
        }

        return {
          status: "success",
          data: {
            ...assetSummary(meta),
            created_at: meta.created_at,
            recipe: meta.recipe
              ? {
                  kind: meta.recipe.kind,
                  intent: meta.recipe.intent,
                  finalPrompt: meta.recipe.finalPrompt,
                  characters: meta.recipe.characters,
                  scene: meta.recipe.scene,
                  parent: meta.recipe.parent,
                  adapter: meta.recipe.adapter,
                }
              : undefined,
            visual_description: visual,
          },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

export function buildAssetListTool(ctx: ToolContext): GloveFoldArgs<AssetListInput> {
  return {
    name: "glove_image_asset_list",
    description:
      "Browse the image asset store — ids, names, dimensions, sources, tags. Never bytes.",
    inputSchema: AssetListSchema,
    async do(input): Promise<ToolResultData> {
      const assets = await ctx.assets.list(input);
      return {
        status: "success",
        data: { count: assets.length, assets: assets.map(assetSummary) },
      };
    },
  };
}

export function buildAssembleTool(
  ctx: ToolContext,
): GloveFoldArgs<AssembleInput> {
  return {
    name: "glove_image_assemble",
    description:
      "Deterministically composite existing assets onto a canvas — contact sheets, " +
      "storyboard grids, side-by-sides, layered comps. No model call. Layers are painted " +
      "in order at (x, y), optionally resized/rotated, and the result is stored as a new asset.",
    inputSchema: AssembleSchema,
    async do(input): Promise<ToolResultData> {
      let sharp: (typeof import("sharp"))["default"];
      try {
        sharp = (await import("sharp")).default;
      } catch {
        return errorResult(
          'glove_image_assemble needs the optional "sharp" peer — install it with: pnpm add sharp',
        );
      }
      try {
        const composites: Array<{ input: Buffer; left: number; top: number }> = [];
        for (const layer of input.layers) {
          const meta = await ctx.assets.get(layer.asset);
          if (!meta) return errorResult(`Layer asset "${layer.asset}" not found`);
          let img = sharp(Buffer.from(await ctx.assets.bytes(layer.asset)));
          if (layer.width || layer.height) {
            img = img.resize({
              width: layer.width,
              height: layer.height,
              fit: layer.fit ?? "cover",
            });
          }
          if (layer.rotate) {
            img = img.rotate(layer.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
          }
          let buf = await img.png().toBuffer();
          if (layer.opacity !== undefined && layer.opacity < 1) {
            // Flat alpha: scale the (ensured) alpha channel by the opacity.
            buf = await sharp(buf)
              .ensureAlpha()
              .linear([1, 1, 1, layer.opacity], [0, 0, 0, 0])
              .png()
              .toBuffer();
          }
          composites.push({ input: buf, left: layer.x, top: layer.y });
        }

        const out = await sharp({
          create: {
            width: input.canvas.width,
            height: input.canvas.height,
            channels: 4,
            background: input.canvas.background ?? "#ffffff",
          },
        })
          .composite(composites)
          .png()
          .toBuffer();

        const spec: AssemblySpec = { canvas: input.canvas, layers: input.layers };
        const asset = await ctx.assets.put(new Uint8Array(out), {
          name: input.name,
          mime: "image/png",
          width: input.canvas.width,
          height: input.canvas.height,
          source: "assembled",
          recipe: { kind: "assembled", spec },
        });
        return {
          status: "success",
          data: assetSummary(asset),
          renderData: {
            kind: "gallery",
            images: [{ ...assetSummary(asset), dataUrl: await renderThumb(ctx, asset) }],
          },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

// ─── Library tools ─────────────────────────────────────────────────────────

export function buildCharacterSaveTool(
  ctx: ToolContext,
): GloveFoldArgs<CharacterSaveInput> {
  return {
    name: "glove_image_character_save",
    description:
      "Create or update a character in the library. The appearance paragraph is spliced " +
      "VERBATIM into every prompt that includes this character — write it prompt-ready. " +
      "Attach identity reference images by asset id to anchor likeness (promote a good " +
      "generation here to lock in a look).",
    inputSchema: CharacterSaveSchema,
    async do(input): Promise<ToolResultData> {
      const existing = await ctx.library.getCharacter(input.name);
      const def: CharacterDef = {
        ...input,
        created_at: existing?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      await ctx.library.saveCharacter(def);
      return {
        status: "success",
        data: { saved: input.name, updated: Boolean(existing) },
        renderData: { kind: "character", def },
      };
    },
  };
}

export function buildCharacterGetTool(ctx: ToolContext): GloveFoldArgs<NameInput> {
  return {
    name: "glove_image_character_get",
    description: "Fetch a character definition from the library by name.",
    inputSchema: NameSchema,
    async do(input): Promise<ToolResultData> {
      const def = await ctx.library.getCharacter(input.name);
      if (!def) {
        const available = (await ctx.library.listCharacters()).map((c) => c.name);
        return errorResult(
          `Character "${input.name}" not found.` +
            (available.length ? ` Available: ${available.join(", ")}` : ""),
        );
      }
      return { status: "success", data: def, renderData: { kind: "character", def } };
    },
  };
}

export function buildCharacterListTool(
  ctx: ToolContext,
): GloveFoldArgs<LibraryListInput> {
  return {
    name: "glove_image_character_list",
    description: "List characters in the library — names, appearance excerpts, ref image counts.",
    inputSchema: LibraryListSchema,
    async do(input): Promise<ToolResultData> {
      const defs = await ctx.library.listCharacters(input);
      return {
        status: "success",
        data: {
          count: defs.length,
          characters: defs.map((d) => ({
            name: d.name,
            display_name: d.display_name,
            appearance_excerpt: d.appearance.slice(0, 120),
            ref_images: d.ref_images?.length ?? 0,
            tags: d.tags,
          })),
        },
      };
    },
  };
}

export function buildCharacterRemoveTool(ctx: ToolContext): GloveFoldArgs<NameInput> {
  return {
    name: "glove_image_character_remove",
    description: "Remove a character from the library.",
    inputSchema: NameSchema,
    async do(input): Promise<ToolResultData> {
      await ctx.library.removeCharacter(input.name);
      return { status: "success", data: { removed: input.name } };
    },
  };
}

export function buildSceneSaveTool(ctx: ToolContext): GloveFoldArgs<SceneSaveInput> {
  return {
    name: "glove_image_scene_save",
    description:
      "Create or update a scene (setting) in the library. The setting block is spliced " +
      "verbatim into prompts that use this scene — the same neon market should look like " +
      "the same neon market across generations.",
    inputSchema: SceneSaveSchema,
    async do(input): Promise<ToolResultData> {
      const existing = await ctx.library.getScene(input.name);
      const def: SceneDef = {
        ...input,
        created_at: existing?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      await ctx.library.saveScene(def);
      return {
        status: "success",
        data: { saved: input.name, updated: Boolean(existing) },
        renderData: { kind: "scene", def },
      };
    },
  };
}

export function buildSceneGetTool(ctx: ToolContext): GloveFoldArgs<NameInput> {
  return {
    name: "glove_image_scene_get",
    description: "Fetch a scene definition from the library by name.",
    inputSchema: NameSchema,
    async do(input): Promise<ToolResultData> {
      const def = await ctx.library.getScene(input.name);
      if (!def) {
        const available = (await ctx.library.listScenes()).map((s) => s.name);
        return errorResult(
          `Scene "${input.name}" not found.` +
            (available.length ? ` Available: ${available.join(", ")}` : ""),
        );
      }
      return { status: "success", data: def, renderData: { kind: "scene", def } };
    },
  };
}

export function buildSceneListTool(ctx: ToolContext): GloveFoldArgs<LibraryListInput> {
  return {
    name: "glove_image_scene_list",
    description: "List scenes in the library — names, setting excerpts.",
    inputSchema: LibraryListSchema,
    async do(input): Promise<ToolResultData> {
      const defs = await ctx.library.listScenes(input);
      return {
        status: "success",
        data: {
          count: defs.length,
          scenes: defs.map((d) => ({
            name: d.name,
            display_name: d.display_name,
            setting_excerpt: d.setting.slice(0, 120),
            tags: d.tags,
          })),
        },
      };
    },
  };
}

export function buildSceneRemoveTool(ctx: ToolContext): GloveFoldArgs<NameInput> {
  return {
    name: "glove_image_scene_remove",
    description: "Remove a scene from the library.",
    inputSchema: NameSchema,
    async do(input): Promise<ToolResultData> {
      await ctx.library.removeScene(input.name);
      return { status: "success", data: { removed: input.name } };
    },
  };
}

// ─── mountImage ────────────────────────────────────────────────────────────

/**
 * Fold the glove_image_* tool surface onto a Glove.
 *
 * - Validates the pipeline (unique enhancer names) and always appends
 *   fitToModel() as the terminal stage.
 * - Folds generation/edit/regenerate (optionally permission-gated), import,
 *   describe, asset list, assemble, and library tools (writes only when
 *   `curate` is true).
 *
 * Async and non-chainable, following the mountMcp / mountMesh convention.
 * Callable before or after build().
 */
export async function mountImage(
  glove: ImageMountTarget,
  config: MountImageConfig,
): Promise<void> {
  const pipeline = config.pipeline ?? defaultPipeline();
  const names = new Set<string>();
  for (const enhancer of pipeline) {
    if (names.has(enhancer.name)) {
      throw new ImageError(`Duplicate pipeline enhancer name: "${enhancer.name}"`);
    }
    names.add(enhancer.name);
  }

  const ctx: ToolContext = {
    adapter: config.adapter,
    assets: config.assets,
    library: config.library,
    pipeline,
    model: config.model,
    defaultCandidates: Math.max(1, config.candidates ?? 1),
    review: config.review,
  };
  const gate = config.requirePermission ?? false;

  glove.fold(buildGenerateTool(ctx, gate));
  glove.fold(buildEditTool(ctx, gate));
  glove.fold(buildRegenerateTool(ctx, gate));
  glove.fold(buildImportTool(ctx));
  glove.fold(buildDescribeTool(ctx));
  glove.fold(buildAssetListTool(ctx));
  glove.fold(buildAssembleTool(ctx));

  glove.fold(buildCharacterGetTool(ctx));
  glove.fold(buildCharacterListTool(ctx));
  glove.fold(buildSceneGetTool(ctx));
  glove.fold(buildSceneListTool(ctx));

  if (config.curate ?? true) {
    glove.fold(buildCharacterSaveTool(ctx));
    glove.fold(buildCharacterRemoveTool(ctx));
    glove.fold(buildSceneSaveTool(ctx));
    glove.fold(buildSceneRemoveTool(ctx));
  }
}
