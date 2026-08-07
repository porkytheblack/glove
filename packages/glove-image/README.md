# glove-image

Image workflows as a first-class Glove surface — prompt pipelines with
enhancer inbetweens, persistent **characters** and **scenes**, reference
images and assembly, all behind a small set of `glove_image_*` tools and a
BYO image-model adapter.

**Status: draft v0.1 — implemented.** Core contracts, the prompt pipeline
and built-in inbetweens, the full `glove_image_*` tool surface, in-memory
reference adapters, and an OpenRouter model adapter ship today (tested
live against `google/gemini-2.5-flash-image`). Still planned: React
renderers, the multi-candidate picker slot, OpenAI/Gemini direct adapters,
system-prompt priming, and the scratchpad/working-environment bridges —
each is marked below. Contracts may still shift before the first release.

```bash
pnpm add glove-image        # (once released)
```

## Why

Today an agent that generates images does it with one ad-hoc tool: a
`generate_image(prompt)` that shells out to a provider and returns a URL.
That shape breaks down the moment the work is a *workflow* rather than a
one-off:

- **Prompts are built, not typed.** The useful prompt is the user's intent
  *plus* house style, *plus* the character's canonical description, *plus*
  the scene's palette, *plus* a model-specific rewrite. That's a pipeline
  with stages, and today every app rebuilds it inline and loses the
  intermediate states.
- **Characters drift.** "Draw Mira again, but at the harbor" only works if
  Mira is a durable thing — a description, reference images, a negative
  list — not a phrase the model half-remembers from six turns ago.
- **Scenes are settings, not sentences.** The same neon market should look
  like the same neon market across ten generations.
- **Existing images are inputs.** Users bring photos; earlier generations
  become references; results get composited into sheets and storyboards.
  Image bytes need a home that isn't the context window.

`glove-image` makes each of these a named primitive with a storage seam,
following the house pattern: adapter contracts you implement, reference
in-memory adapters for dev, one `mountImage(glove, …)` that folds the
tools, and Zod-first schemas throughout.

### When to use it

- The app generates images repeatedly with recurring subjects, styles, or
  settings (character art, storyboards, product shots, brand assets).
- You want prompt construction to be inspectable and composable rather
  than a template string.
- Users bring their own images in, and outputs feed back in as inputs.

If you need exactly one "make me a picture" tool, a hand-rolled
`glove.fold(...)` around your provider is still simpler. `glove-image`
earns its keep when generation is a workflow.

## Mental model

Four pieces, deliberately separated:

| Piece | What it is | Contract |
|-------|-----------|----------|
| **Assets** | Every image the workflow touches — imported, generated, edited, assembled — stored with metadata and lineage. Bytes never enter model context; the model works with asset ids. | `ImageAssetStore` |
| **Library** | Durable characters and scenes, curated by the agent or the host app, referenced by name in generation calls. | `ImageLibraryAdapter` |
| **Pipeline** | An ordered list of *inbetweens* (`PromptEnhancer`s) that turn a raw intent into the final request — expanding characters/scenes, injecting style, running an LLM rewrite — each stage recorded in a trace. | `PromptEnhancer[]` |
| **Model** | The image model behind a capability-declaring adapter — generate, edit, variations. | `ImageModelAdapter` |

```
intent + {characters, scene, refs}
        │
        ▼
  Prompt pipeline (inbetweens, in order)
    expandCharacters → expandScenes → styleDirective → llmEnhance → fitToModel
        │                                    each stage appends to draft.trace
        ▼
  ImageModelAdapter.generate(request)
        │
        ▼
  candidates → ImageAssetStore (with Recipe lineage) → display slot / picker
```

## Quick start

```ts
import { Glove, Displaymanager, MemoryStore, createAdapter } from "glove-core";
import {
  mountImage,
  InMemoryImageAssetStore,
  InMemoryImageLibrary,
  expandCharacters,
  expandScenes,
  styleDirective,
  llmEnhance,
} from "glove-image";
import { openrouterImages } from "glove-image/openrouter";

const glove = new Glove({
  store: new MemoryStore("studio"),
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: "You are an art director. Use the image tools to create and refine images.",
  compaction_config: { compaction_instructions: "Summarize the art direction so far." },
});

await mountImage(glove, {
  adapter: openrouterImages(),   // reads OPENROUTER_API_KEY; default model google/gemini-2.5-flash-image
  assets: new InMemoryImageAssetStore(),
  library: new InMemoryImageLibrary(),
  model: createAdapter({ provider: "openrouter", model: "openai/gpt-4o-mini", stream: false }),
  pipeline: [
    expandCharacters(),
    expandScenes(),
    styleDirective("hand-painted gouache, muted palette, soft rim light"),
    llmEnhance({ instructions: "Tighten composition language. Keep subject identity wording verbatim." }),
  ],
});

glove.build();

await glove.processRequest(
  "Create a character called Mira — a wiry sky-courier in her 20s with a patched flight jacket. Then draw her landing at a neon night market.",
);
// Agent: glove_image_character_save({ name: "mira", ... })
//        glove_image_scene_save({ name: "neon-market", ... })
//        glove_image_generate({ intent: "Mira landing", characters: ["mira"], scene: "neon-market" })
```

## Assets

An `ImageAsset` is the unit everything else trades in. Bytes live in the
store; the model sees ids, dimensions, and short descriptions.

```ts
interface ImageAsset {
  id: string;                       // "img_<nanoid>"
  name?: string;                    // optional human label ("mira-ref-front")
  mime: string;
  width: number;
  height: number;
  source: "imported" | "generated" | "edited" | "assembled";
  recipe?: Recipe;                  // lineage — see below
  created_at: string;               // ISO 8601
  tags?: string[];
}

interface ImageAssetStore {
  identifier: string;
  put(bytes: Uint8Array, meta: Omit<ImageAsset, "id" | "created_at">): Promise<ImageAsset>;
  get(id: string): Promise<ImageAsset | null>;
  bytes(id: string): Promise<Uint8Array>;
  list(filter?: { source?: ImageAsset["source"]; tags?: string[]; name_contains?: string }): Promise<ImageAsset[]>;
  remove(id: string): Promise<void>;
  /** Optional: downscaled bytes for display renderData. Falls back to full bytes. */
  thumbnail?(id: string, maxEdge: number): Promise<Uint8Array>;
}
```

`InMemoryImageAssetStore` ships as the reference (process-local, lost on
restart). Production stores back onto S3/GCS/disk — the contract is five
methods and stays SDK-free, same posture as glovebox's storage adapters.

### Recipe — lineage on every derived asset

Every generated, edited, or assembled asset records how it was made, so
any result can be **regenerated or varied** without re-deriving the
prompt:

```ts
interface Recipe {
  kind: "generated" | "edited" | "assembled";
  intent?: string;                  // the raw ask, untouched
  finalPrompt?: string;             // what actually went to the model
  negative?: string;
  params?: GenerationParams;        // size, seed, candidates, model hints
  adapter?: string;                 // ImageModelAdapter.name
  characters?: string[];            // library names, as resolved at the time
  scene?: string;
  refs?: Array<{ asset: string; role: RefRole }>;
  trace?: TraceEntry[];             // the pipeline trace — see Prompt pipeline
  parent?: string;                  // for kind "edited": the source asset id
  spec?: AssemblySpec;              // for kind "assembled"
}
```

`glove_image_regenerate({ asset, tweak? })` replays a recipe — same
pipeline, same refs, optionally a `tweak` string appended to the intent —
which is what makes "same but at dusk" a one-call operation.

## Prompt pipeline — enhancer inbetweens

The pipeline is the spine of the package. A generation call never sends
the model's raw text to the image model; it builds a `PromptDraft` and
runs it through the configured inbetweens **in order**. Each inbetween is
a small named transform; each appends to a trace, so the final request is
fully explainable.

```ts
interface PromptDraft {
  intent: string;                   // the original ask — never mutated
  positive: string;                 // the working prompt
  negative?: string;
  refs: RefImage[];                 // accumulated reference images
  params: GenerationParams;         // { size?, seed?, candidates?, extra? }
  requested: { characters: string[]; scene?: string };  // library names from the call
  characters: CharacterDef[];       // resolved by expandCharacters()
  scene?: SceneDef;                 // resolved by expandScenes()
  trace: TraceEntry[];
}

interface TraceEntry {
  enhancer: string;                 // which inbetween ran
  note?: string;                    // what it did / why it degraded something
  positive_after: string;           // snapshot after this stage
}

type RefRole = "identity" | "style" | "composition" | "content" | "mask";

interface RefImage {
  asset: string;                    // ImageAsset id
  role: RefRole;
  weight?: number;                  // 0..1, adapter-interpreted
}

interface PromptEnhancer {
  name: string;
  run(draft: PromptDraft, ctx: EnhancerContext): Promise<PromptDraft | void>; // void = no change
}

interface EnhancerContext {
  library: ImageLibraryReader;      // read-only character/scene lookup
  assets: Pick<ImageAssetStore, "get" | "list">;
  model?: ModelAdapter;             // an LLM slot for rewrite passes (the mount's `model` config)
  capabilities: ImageModelCapabilities;  // what the target model supports
  note(message: string): void;      // attach an explanation to this stage's trace entry
  signal?: AbortSignal;
}
```

### Built-in inbetweens (v0.1)

| Inbetween | What it does |
|-----------|--------------|
| `expandCharacters()` | For each name in the call's `characters`, loads the library record, splices its canonical appearance block into `positive`, merges its `negative`, and attaches its reference images as `identity` refs. Missing names are a tool error naming the miss, not a silent skip. |
| `expandScenes()` | Same for the call's `scene` — setting, palette, lighting, mood, plus `composition`/`style` refs. |
| `styleDirective(text)` | Appends a fixed house-style clause. The dumb, reliable one. |
| `negativeDefaults(list)` | Merges a standing negative list ("extra fingers, watermark, …") without clobbering per-call negatives. |
| `llmEnhance({ model?, instructions })` | One LLM rewrite pass over `positive`. The contract is strict: it receives the draft and the intent, must preserve character-appearance wording verbatim (identity consistency dies in paraphrase), and returns only the rewritten prompt. Uses `ctx.model` unless a dedicated adapter is passed. |
| `fitToModel()` | Terminal, always appended automatically: clamps the draft to `ctx.capabilities` — folds `negative` into `positive` as an "Avoid: …" clause when the model has no negative slot, drops or merges refs beyond `maxRefs` (identity refs survive first), snaps `size` to a supported size. Every degradation lands in the trace as a `note` rather than happening silently. |

Custom inbetweens are just the interface — a two-line function for a
watermark policy, a lookup against your brand system, a translation pass.

**Ordering is the consumer's.** The default pipeline is
`[expandCharacters(), expandScenes(), fitToModel()]`; anything passed to
`mountImage` replaces the middle, and `fitToModel()` is always run last
whether or not you list it.

**Why args, not inline syntax.** Characters and scenes are referenced via
tool arguments (`characters: ["mira"]`), never parsed out of prose. `@` is
already Glove's subagent routing signal, `/` is the extension trigger, and
inline `{{character:mira}}` templating puts a parser between the model and
its own prompt. The tool schema is the interface; the model reads the
library via the list tools and passes names.

## Characters

A character is a durable identity: wording that must stay stable, images
that anchor likeness, and negatives that fence off drift.

```ts
interface CharacterDef {
  name: string;                     // library key, kebab-case ("mira")
  display_name?: string;
  /** One-paragraph canonical appearance. Spliced VERBATIM into prompts — write it prompt-ready. */
  appearance: string;
  /** Non-visual notes for the agent (personality, role). Never sent to the image model. */
  notes?: string;
  negative?: string;                // e.g. "no goggles, never smiling"
  ref_images?: Array<{ asset: string; label?: string }>;  // identity anchors, best-first
  tags?: string[];
  created_at: string;
  updated_at: string;
}
```

Design rules the tools enforce:

- **`appearance` is prompt text, owned by the library.** `expandCharacters()`
  splices it verbatim and `llmEnhance` is contractually barred from
  rewording it. Consistency comes from repetition, not memory.
- **Ref images are assets.** A character's reference images live in the
  asset store like everything else; promoting a good generation to a
  character ref is `glove_image_character_save` with the asset id — the
  canonical "lock in this look" move.
- **`notes` never reach the image model.** Personality belongs to the
  agent's reasoning, not the prompt.

Scenes are the same shape, pointed at settings:

```ts
interface SceneDef {
  name: string;
  display_name?: string;
  /** Canonical setting block: location, era, palette, lighting, mood. Prompt-ready, spliced verbatim. */
  setting: string;
  negative?: string;
  ref_images?: Array<{ asset: string; role: "style" | "composition"; label?: string }>;
  tags?: string[];
  created_at: string;
  updated_at: string;
}
```

### Library contract

```ts
interface ImageLibraryReader {
  getCharacter(name: string): Promise<CharacterDef | null>;
  listCharacters(filter?: { tags?: string[]; name_contains?: string }): Promise<CharacterDef[]>;
  getScene(name: string): Promise<SceneDef | null>;
  listScenes(filter?: { tags?: string[]; name_contains?: string }): Promise<SceneDef[]>;
}

interface ImageLibraryAdapter extends ImageLibraryReader {
  identifier: string;
  saveCharacter(def: CharacterDef): Promise<void>;   // upsert by name
  removeCharacter(name: string): Promise<void>;
  saveScene(def: SceneDef): Promise<void>;
  removeScene(name: string): Promise<void>;
}
```

`InMemoryImageLibrary` ships as reference. Apps that already run
`glove-memory` can back the library onto the entity graph; the contract
stays independent so neither package requires the other.

## Bringing images in, and assembling them

Three distinct doors, because "use this image" means three different
things:

1. **Import** — `glove_image_import` takes a URL, base64, or a
   user-message `ContentPart` image and lands it in the asset store as a
   first-class asset. From there it can be a ref, an edit base, or an
   assembly layer. Host apps can also call `imports` directly
   (`importAsset(store, bytes | url, meta)`) to pre-seed sessions.
2. **Reference** — any asset can ride a generation call as a `RefImage`
   with a role: `identity` (this face), `style` (this look), `composition`
   (this framing), `content` (img2img base), `mask` (edit region).
   Adapters declare which roles they honor; `fitToModel()` reconciles.
3. **Assemble** — deterministic compositing of existing assets into one
   image, no model call at all:

```ts
interface AssemblySpec {
  canvas: { width: number; height: number; background?: string };  // CSS color
  layers: Array<{
    asset: string;
    x: number; y: number;
    width?: number; height?: number;      // omit = natural size
    fit?: "cover" | "contain" | "fill";
    rotate?: number;
    opacity?: number;                     // 0..1
  }>;                                     // painted in order
}
```

Assembly is backed by [sharp](https://sharp.pixelplumbing.com) as an
**optional peer** — `glove_image_assemble` refuses with a clear install
hint when sharp is absent, and the rest of the package works without it.
Apps already running `glove-working-environment` + `glove-env-images` can
do arbitrarily fancier pixel work there; `AssemblySpec` covers the
declarative 90% (contact sheets, storyboard grids, side-by-sides,
layered comps) in one call.

Generative assembly — "put Mira *into* this photo" — is not assembly;
it's `glove_image_edit` with `content` + `mask` refs against an adapter
that supports `edit`.

## `ImageModelAdapter` — the model seam

Mirrors `ModelAdapter`'s posture: a small interface, capabilities
declared up front, provider quirks absorbed inside.

```ts
interface ImageModelCapabilities {
  modes: Array<"generate" | "edit" | "variation">;
  maxRefs: number;                       // 0 = text-only
  refRoles: RefRole[];                   // which roles it honors
  sizes: string[] | "flexible";          // e.g. ["1024x1024", "1536x1024"]
  negativePrompt: boolean;
  seed: boolean;
  maxCandidates: number;
}

interface ImageGenerateRequest {
  prompt: string;
  negative?: string;
  refs: Array<RefImage & { bytes: Uint8Array; mime: string }>;  // resolved by the mount, not the adapter
  size?: string;
  seed?: number;
  candidates?: number;
  extra?: Record<string, unknown>;       // provider passthrough, like reasoning.extraBody
}

interface ImageEditRequest extends Omit<ImageGenerateRequest, "refs"> {
  base: { bytes: Uint8Array; mime: string };
  mask?: { bytes: Uint8Array; mime: string };
  refs: Array<RefImage & { bytes: Uint8Array; mime: string }>;
}

interface ImageModelResult {
  images: Array<{ bytes: Uint8Array; mime: string; seed?: number }>;
  /** Provider-reported final prompt, if it rewrites (DALL·E-style). Recorded in the recipe. */
  revised_prompt?: string;
}

interface ImageModelAdapter {
  name: string;
  capabilities: ImageModelCapabilities;
  generate(req: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageModelResult>;
  edit?(req: ImageEditRequest, signal?: AbortSignal): Promise<ImageModelResult>;
}
```

Notes:

- **The mount resolves bytes, the adapter never touches the store.**
  Adapters receive materialized bytes and stay storage-agnostic.
- **`fitToModel()` is the compatibility layer.** Adapters never receive a
  negative prompt they can't take or more refs than `maxRefs` — they can
  assume requests are in-capability and throw on anything else.
- **v0.1 ships one reference adapter**, a subpath with zero SDK deps
  (plain `fetch`): `glove-image/openrouter` — image-output models through
  OpenRouter's chat endpoint (`openrouterImages()`, default
  `google/gemini-2.5-flash-image`; generate + edit, refs as image inputs,
  candidates fan out as parallel requests). Planned: `glove-image/openai`
  (gpt-image-1) and `glove-image/gemini` direct. BYO for Stability,
  Replicate, fal, ComfyUI, or anything local.

## `mountImage` — the canonical entry point

```ts
await mountImage(glove, {
  adapter,                          // ImageModelAdapter                  (required)
  assets,                           // ImageAssetStore                    (required)
  library,                          // ImageLibraryAdapter                (required)
  pipeline?,                        // PromptEnhancer[]  — default [expandCharacters(), expandScenes()]
  model?,                           // ModelAdapter handed to enhancers (llmEnhance) — usually the agent's model
  curate?,                          // default true; false folds read-only library tools only
  candidates?,                      // default 1; clamped to capabilities.maxCandidates
  review?,                          // vision review loop config — see below
  requirePermission?,               // default false; true gates generate/edit/regenerate
});
```

What it does: validates the pipeline (unique names), appends
`fitToModel()`, and folds the tools below. Async, non-chainable, callable
before or after `build()` — same convention as `mountMcp` / `mountMesh`.
*Planned:* priming the system prompt with a short standing block (adapter
capabilities, current character/scene names, the asset-id rule) — today
the tool descriptions carry that context.

### The tools

| Tool | Input (shape) | Behavior |
|------|--------------|----------|
| `glove_image_generate` | `{ intent, characters?, scene?, refs?, negative?, size?, seed?, candidates?, name?, tags? }` | Builds the draft, runs the pipeline, calls `adapter.generate`, stores every candidate with its recipe, and returns all candidate summaries (with thumbnails on `renderData`). *Planned:* a `pushAndWait` picker slot for multi-candidate runs. |
| `glove_image_edit` | `{ asset, instruction, mask?, refs?, name? }` | Edit/inpaint against `adapter.edit`; recipe records `parent`. Error if the adapter lacks `edit` mode. |
| `glove_image_regenerate` | `{ asset, tweak? }` | Replays the asset's recipe through the *current* pipeline, appending `tweak` to the intent. |
| `glove_image_assemble` | `AssemblySpec & { name? }` | Deterministic composite via sharp; stores result with `kind: "assembled"`. |
| `glove_image_import` | `{ url? \| data?, mime?, name?, tags? }` | Lands an external image in the store — http(s) URL, data: URL, or raw base64. Format and dimensions are sniffed from the bytes. *Planned:* `from_message: true` to pull image `ContentPart`s off the current user message. |
| `glove_image_describe` | `{ asset }` | Metadata (dims, source, recipe summary) at zero model cost; when `review.vision` is configured, adds a one-paragraph visual description. The context-safe way to "look at" an asset. |
| `glove_image_asset_list` | `{ filter? }` | Browse the store — ids, names, dims, sources, tags. Never bytes. |
| `glove_image_character_save` / `_get` / `_list` / `_remove` | `CharacterDef` fields | Library CRUD. `_save`/`_remove` only folded when `curate: true`. |
| `glove_image_scene_save` / `_get` / `_list` / `_remove` | `SceneDef` fields | Same. |

Tool-result discipline throughout: `data` (model-facing) carries asset
ids, dimensions, trace summaries, and short descriptions; `renderData`
(client-only) carries thumbnail data-URLs for renderers. Bytes never
enter `data`, so context cost is flat no matter how many images a session
touches.

### Vision review loop (opt-in)

Generation quality jumps when the agent can *see* what came back. With a
vision-capable `ModelAdapter` configured, `glove_image_generate` can
self-check:

```ts
review: {
  vision: createAdapter({ provider: "anthropic" }),  // any vision-capable ModelAdapter
  rounds: 1,                                          // max refine rounds, default 0 (off)
  rubric?: "Character must match the appearance block. Flag anatomy errors.",
}
```

Loop: generate → vision model critiques each candidate against the
intent + rubric + character appearance blocks → pass: done; fail: the
critique is appended to the draft (traced as enhancer `"review"`), one
regeneration round runs. Bounded by `rounds`, off by default, and every
round's critique lands in the final recipe — inspectable, like the rest
of the pipeline.

## React surface (`glove-image/react`) — planned

Prebuilt `ToolConfig`s with colocated renderers, mirroring the tool
registry pattern — copy-paste or import:

- **Gallery slot** (`pushAndForget`, `"stay"`) — renders generated
  candidates from `renderData` thumbnails; `renderResult` re-renders from
  history.
- **Candidate picker** (`pushAndWait`, `"hide-on-complete"`) — grid of
  candidates, click to choose; the resolve value is the chosen asset id.
- **Character card** — compact renderer for `_get`/`_save` results:
  name, appearance excerpt, ref thumbnails.
- **Asset browser** — renderer for `glove_image_asset_list`.

Host apps that render fully custom UI use the raw tools and read
`renderData` themselves; the server-side tool surface is identical either
way. Voice-first apps should configure `candidates: 1` (the picker is a
click surface) — `glove_image_describe` narrates results instead.

## Integrations

- **`glove-env-images` / working-environment** — `glove-image` is the
  *workflow* layer (prompts, identity, lineage); `env:images` is the
  *pixel* layer. `mountImage` and a working environment compose: an
  `imageAssets()` stdlib adapter (planned, this package) mounts the asset
  store read-only into the environment tree so scripts can post-process
  generations at scale.
- **Glovebox** — pairs with the `glovebox/media` base. Assets export
  through the standard `/output` path as `FileRef`s; a
  `glovebox-image-studio` example is planned.
- **`glove-scratchpad`** — the store surfaces naturally as tables:
  `image_assets` (stable select), `image_characters` / `image_scenes`
  (select + insert), `images` (volatile select = generation). An
  `imageResources(db, mount)` helper is planned so SQL-surface agents get
  the same workflows.
- **Subscriber events** — none added in v0.1. Observability rides on
  `tool_use` / `tool_use_result` for the `glove_image_*` tools, the same
  posture `glove-mesh` took. Dedicated events (`image_generate_start` /
  `_end` with timing + cost) are a candidate for v0.2 once the core event
  union is worth touching.

## Permissions and cost

Generation spends real money. `requirePermission: true` marks
`glove_image_generate`, `glove_image_edit`, and `glove_image_regenerate`
with `requiresPermission: true`, riding the existing (tool, input)
permission flow — hosts get per-call consent with the standard store
keying. `candidates` is clamped to `capabilities.maxCandidates` and to
the mount's own `candidates` config, whichever is lower, so a model
can't fan out spend on its own.

## Out of scope (v0.1)

- **Video** — `ContentPart` reserves the type; adapters here are stills only.
- **Fine-tuning / LoRA training** — character consistency is prompt- and
  ref-driven; training pipelines are a different product.
- **Upscaling / restoration models** — representable as an
  `ImageModelAdapter` with an `edit`-only mode if you BYO; no built-in.
- **CDN/serving concerns** — the asset store contract stops at bytes;
  URLs, signing, and caching are the host's.
- **Cost accounting** — recorded nowhere in v0.1; the host meters at the
  adapter boundary if needed.
- **Inline prompt syntax** — no `{{character:x}}` parsing, by design (see
  Prompt pipeline).
- **Multi-character identity guarantees** — `expandCharacters()` splices
  any number of characters, but keeping several likenesses distinct in
  one frame is model-dependent; the package supplies the refs and the
  wording, not a guarantee.

## Open questions

1. **Promotion ergonomics** — should choosing a picker candidate offer a
   one-tap "save as character ref"? Leaning yes: an optional
   `promote_to?: { character: string }` arg on the picker resolve.
2. **Library ↔ glove-memory bridge** — ship a `glove-memory`-backed
   `ImageLibraryAdapter` in this package (optional peer), or leave it as
   a documented recipe? Leaning recipe-first.
3. **Seed handling across adapters** — providers disagree on determinism;
   whether `regenerate` should default to reusing the recorded seed or
   dropping it needs provider-by-provider testing.
4. **Trace verbosity in `data`** — the full trace is recipe-recorded, but
   how much reaches the model per call (all notes vs. degradations only)
   affects both context cost and the model's ability to self-correct.
   Start with degradations-only.

## Quick reference — where things live

| Need | Symbol |
|------|--------|
| Mount the surface | `mountImage(glove, { adapter, assets, library, … })` |
| Model contract | `ImageModelAdapter`, `ImageModelCapabilities` |
| Reference model adapter | `openrouterImages` from `glove-image/openrouter` (`glove-image/openai`, `glove-image/gemini` planned) |
| Asset storage contract | `ImageAssetStore`; reference `InMemoryImageAssetStore` |
| Character/scene storage | `ImageLibraryAdapter`; reference `InMemoryImageLibrary` |
| Author an inbetween | `PromptEnhancer` interface |
| Built-in inbetweens | `expandCharacters`, `expandScenes`, `styleDirective`, `negativeDefaults`, `llmEnhance`, `fitToModel` |
| Assembly spec | `AssemblySpec` (sharp optional peer) |
| Lineage | `Recipe` on `ImageAsset.recipe` |
| React renderers | `glove-image/react` (planned) |
| Reference in-memory adapters | `InMemoryImageAssetStore`, `InMemoryImageLibrary` from `glove-image/in-memory` |
