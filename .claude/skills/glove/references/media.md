# Image and video workflows (glove-image, glove-video)

> Read when an agent generates, edits or reviews images or video: `mountImage`, the prompt pipeline, characters and scenes, lineage, cost tracking and BYO image-model adapters.
>
> Part of the `glove` skill. Start from [SKILL.md](../SKILL.md) for the mental model and the primitives map.

## Image Workflows (`glove-image`)

Agentic image generation. Where a hand-rolled `generate_image(prompt)` tool covers exactly one call, `glove-image` covers the workflow: prompts are *built* by a pipeline, subjects and settings are *durable*, existing images are *inputs*, results carry *lineage*, and every model call is *metered*.

### When to use it

- Images recur with the same subjects, styles or settings (character art, storyboards, product shots, brand assets).
- Prompt construction should be inspectable and composable, not a template string.
- Users bring images in, and outputs feed back in as references.
- You need to know what generation actually cost.

One "make me a picture" tool? Plain `glove.fold(...)` is still simpler.

### `mountImage` — the canonical entry point

```typescript
import {
  mountImage, InMemoryImageAssetStore, InMemoryImageLibrary,
  expandCharacters, expandScenes, styleDirective, llmEnhance, UsageMeter,
} from "glove-image";
import { openrouterImages } from "glove-image/openrouter";

const meter = new UsageMeter();

await mountImage(glove, {
  adapter: openrouterImages(),             // ImageModelAdapter          (required)
  assets: new InMemoryImageAssetStore(),   // ImageAssetStore            (required)
  library: new InMemoryImageLibrary(),     // ImageLibraryAdapter        (required)
  model: createAdapter({ provider: "openrouter", model: "openai/gpt-4o-mini", stream: false }),
  pipeline: [expandCharacters(), expandScenes(), styleDirective("gouache"), llmEnhance()],
  review: { vision: visionAdapter, rounds: 1, rubric: "..." },  // opt-in vision
  usage: meter,
  onUsage: (source, usage) => billing.record(source, usage),
  curate: true,             // default — false folds read-only library tools
  candidates: 1,            // default; clamped to capabilities.maxCandidates
  requirePermission: false, // true gates generate/edit/regenerate
});
```

Async, non-chainable, callable before or after `build()` (same convention as `mountMcp` / `mountMesh`). It validates the pipeline (unique enhancer names — duplicates throw), appends `fitToModel()`, and folds the tools.

### The prompt pipeline (the core idea)

A generation **never** sends raw model text to the image model. It builds a `PromptDraft` and runs it through the enhancers in order, appending one `TraceEntry` per stage:

```typescript
interface PromptDraft {
  intent: string;        // the original ask — NEVER mutated
  positive: string;      // the working prompt
  negative?: string;
  refs: RefImage[];
  params: GenerationParams;                            // { size?, seed?, candidates?, extra? }
  requested: { characters: string[]; scene?: string }; // names from the call
  characters: CharacterDef[];  // resolved by expandCharacters()
  scene?: SceneDef;            // resolved by expandScenes()
  trace: TraceEntry[];         // { enhancer, note?, positive_after }
}

interface PromptEnhancer {
  name: string;   // must be unique across the pipeline
  run(draft: PromptDraft, ctx: EnhancerContext): Promise<PromptDraft | void>;  // void = keep mutated draft
}

interface EnhancerContext {
  library: ImageLibraryReader;
  assets: Pick<ImageAssetStore, "get" | "list">;
  model?: ModelAdapter;                  // the mount's `model` slot
  capabilities: ImageModelCapabilities;
  note(message: string): void;           // → this stage's trace entry
  recordUsage(usage: Partial<ImageUsage>): void;
  signal?: AbortSignal;
}
```

| Inbetween | Behavior |
|-----------|----------|
| `expandCharacters()` | Splices each named character's `appearance` VERBATIM, merges its `negative`, attaches its ref images as `identity` refs. Missing name → `ImageCharacterNotFoundError` naming what IS available. |
| `expandScenes()` | Same for the scene's `setting`, plus `style`/`composition` refs. |
| `styleDirective(text)` | Appends a fixed house-style clause. |
| `negativeDefaults(list)` | Merges standing negatives without duplicating or clobbering per-call ones. |
| `llmEnhance({ model?, instructions? })` | One LLM rewrite pass; instructed to preserve character wording verbatim. Skips with a trace note when no model. Reports its token usage. |
| `fitToModel()` | **Terminal, always appended.** Folds `negative` into the prompt as `Avoid: …` when the model has no negative slot; drops unsupported ref roles; clamps refs to `maxRefs` (identity first); snaps `size`; clamps `candidates`; drops unsupported `seed`. Every adjustment → a trace note. |

Default pipeline when none is passed: `[expandCharacters(), expandScenes()]`. Whatever you pass replaces the middle; `fitToModel()` runs last regardless.

### Characters & scenes

```typescript
interface CharacterDef {
  name: string;              // kebab-case library key
  display_name?: string;
  appearance: string;        // ONE paragraph, spliced VERBATIM — write it prompt-ready
  notes?: string;            // non-visual; NEVER sent to the image model
  negative?: string;
  ref_images?: Array<{ asset: string; label?: string }>;  // identity anchors
  tags?: string[];
  created_at: string; updated_at: string;
}

interface SceneDef {
  name: string; display_name?: string;
  setting: string;           // location/era/palette/lighting/mood, spliced verbatim
  negative?: string;
  ref_images?: Array<{ asset: string; role: "style" | "composition"; label?: string }>;
  tags?: string[]; created_at: string; updated_at: string;
}
```

Consistency comes from **repetition, not memory** — the library owns the wording and it is re-spliced every call. Promoting a good generation to a character ref (`ref_images: [{ asset: "img_..." }]`) is the "lock in this look" move.

### Assets, lineage, regeneration

```typescript
interface Recipe {
  kind: "generated" | "edited" | "assembled";
  intent?: string; finalPrompt?: string; negative?: string;
  params?: GenerationParams; adapter?: string;
  characters?: string[]; scene?: string;
  refs?: Array<{ asset: string; role: RefRole }>;
  trace?: TraceEntry[];
  parent?: string;        // "edited": source asset
  spec?: AssemblySpec;    // "assembled"
  usage?: ImageUsage;     // what this asset cost
}
```

`glove_image_regenerate({ asset, tweak? })` replays a `generated` recipe through the **current** pipeline (library edits since are picked up) with `tweak` appended to the intent. Regenerating an import/edit is refused with a clear error.

### Usage & cost tracking

```typescript
interface ImageUsage { requests: number; tokens_in: number; tokens_out: number; cost_usd?: number }
type UsageSource = "generate" | "edit" | "enhance" | "review" | "describe";
```

Four scopes: per call (`data.usage`), per asset (`Recipe.usage`), per session (`UsageMeter.report()` → `{ total, by_source }`, also readable by the agent via `glove_image_usage`), and per host (`onUsage(source, usage)`). Adapters opt in by returning `usage` on `ImageModelResult`; one that reports nothing still counts `{ requests: 1 }`. OpenRouter reports **real USD** (`usage: { include: true }`).

### Vision (opt-in)

`review: { vision, rounds?, rubric? }` — any vision-capable `ModelAdapter`. Powers two things: `glove_image_describe` gains a `visual_description`, and with `rounds > 0` each generation is critiqued (PASS → done; FAIL → critique appended as revision notes, traced as the `review` stage, one more round). Off by default because an image costs ~25k input tokens per look.

### Tools folded

`glove_image_generate` · `_edit` · `_regenerate` · `_import` · `_describe` · `_asset_list` · `_assemble` · `_usage` · `_character_save/_get/_list/_remove` · `_scene_save/_get/_list/_remove` (writes gated by `curate`).

Model-facing `data` carries asset ids/dimensions/degradations/usage; `renderData` carries thumbnail data-URLs. **Bytes never enter `data`** — context cost is flat regardless of how many images a session touches.

### `ImageModelAdapter` (BYO)

```typescript
interface ImageModelCapabilities {
  modes: Array<"generate" | "edit" | "variation">;
  maxRefs: number; refRoles: RefRole[];
  sizes: string[] | "flexible";
  negativePrompt: boolean; seed: boolean; maxCandidates: number;
}

interface ImageModelAdapter {
  name: string;
  capabilities: ImageModelCapabilities;
  generate(req: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageModelResult>;
  edit?(req: ImageEditRequest, signal?: AbortSignal): Promise<ImageModelResult>;
}
```

The mount resolves ref bytes before calling — adapters receive materialised bytes and never touch the store, and may assume requests are already in-capability (that's `fitToModel`'s job). Ships `openrouterImages({ apiKey?, model?, baseUrl?, referer?, title? })` from `glove-image/openrouter` (plain `fetch`, default `google/gemini-2.5-flash-image`, generate + edit, candidate fan-out).

### Quick reference — where things live

| Need | Symbol |
|------|--------|
| Mount the surface | `mountImage(glove, { adapter, assets, library, … })` |
| Model contract | `ImageModelAdapter`, `ImageModelCapabilities` |
| Reference model adapter | `openrouterImages` from `glove-image/openrouter` |
| Asset storage contract | `ImageAssetStore`; reference `InMemoryImageAssetStore` |
| Character/scene storage | `ImageLibraryAdapter`; reference `InMemoryImageLibrary` |
| Author an inbetween | `PromptEnhancer` from `glove-image/pipeline` |
| Built-in inbetweens | `expandCharacters`, `expandScenes`, `styleDirective`, `negativeDefaults`, `llmEnhance`, `fitToModel` |
| Run a pipeline by hand | `createDraft`, `runPipeline`, `defaultPipeline` |
| Spend accounting | `ImageUsage`, `UsageMeter`, `addUsage`, `emptyUsage` |
| Lineage | `Recipe` on `ImageAsset.recipe` |
| Assembly | `AssemblySpec` (needs optional `sharp` peer) |
| Byte helpers | `sniffImage`, `toDataUrl`, `fromDataUrl` |
| Error classes | `ImageError`, `ImageAssetNotFoundError`, `ImageCharacterNotFoundError`, `ImageSceneNotFoundError`, `ImageCapabilityError` |
