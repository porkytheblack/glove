# glove-video

Video generation as a first-class Glove workflow surface: traceable temporal
prompt pipelines, durable characters and scenes, provider-neutral generation,
extension and transformation, plus checkpointed multi-shot flows.

**Status: draft v0.1.** The contracts, in-memory stores, OpenRouter adapter,
prompt pipeline, model-backed actual-video review gate, flow runner, and
complete `glove_video_*` tool surface are implemented. Additional provider
adapters and React renderers remain separate follow-ups.

```bash
pnpm add glove-video # once released
```

## Why this is a separate package

A one-off `generate_video(prompt)` tool stops being useful as soon as a project
has continuity:

- A character's appearance and movement need to survive across shots.
- Scenes need stable lighting, palette, and ambient motion.
- Video prompts have time: beats, camera movement, duration, aspect ratio,
  resolution, audio, and model-specific limits.
- Provider calls are long-running jobs. Progress and cancellation matter.
- A sequence can fail on shot four after three expensive generations. Retrying
  should resume at shot four, not start again.
- Generated drafts need to be watched against the brief. A filename, prompt,
  or successful provider job is not evidence that the result is good.

`glove-video` makes those concerns explicit while leaving credentials, object
storage, and provider choice with the host application. Provider-specific
polling lives inside each `VideoModelAdapter`.

The bundled OpenRouter adapter owns polling and downloads for you. Custom
adapters remain useful because video providers differ substantially in job
creation, reference inputs, continuation, transformation, and output delivery.

## Architecture

| Piece | Responsibility |
|---|---|
| `VideoAssetStore` | Stores completed video bytes, metadata, and lineage. Model context sees asset ids, never bytes. |
| `VideoLibraryAdapter` | Stores reusable character and scene continuity definitions. |
| `VideoPromptEnhancer[]` | Builds an inspectable prompt and records one trace entry per stage. |
| `VideoModelAdapter` | Generates, extends, or transforms clips. Provider polling stays behind this contract. |
| `VideoReviewStore` | Keeps evidence-backed pass/revise decisions for each actual video candidate. |
| `VideoFlowStore` | Stores flow definitions and checkpoints each shot of every run. |
| `runVideoFlow` | Validates dependencies, executes in stable topological order, and resumes without repeating successful shots. |

```text
intent + beats + characters + scene + references
                        │
                        ▼
             temporal prompt pipeline
       expand characters → scenes → beats → custom passes
                        │
                        ▼
                  fitVideoToModel
                        │
                        ▼
        VideoModelAdapter (create + poll + download)
                        │
                        ▼
              internal VideoAssetStore draft
                        │
                        ▼
       video-capable reviewer watches actual bytes
                 PASS ─┴─ REVISE
                   │         │
                   │         └── feedback → regenerate → review
                   ▼
       explicit deliver gate + user-facing renderData
```

## Quick start

```ts
import { Glove, Displaymanager, MemoryStore, createAdapter } from "glove-core";
import {
  InMemoryVideoAssetStore,
  InMemoryVideoFlowStore,
  InMemoryVideoLibrary,
  InMemoryVideoReviewStore,
  cameraDirective,
  defaultVideoPipeline,
  mountVideo,
  videoStyleDirective,
  type VideoModelAdapter,
} from "glove-video";

const videos: VideoModelAdapter = {
  name: "my-provider:model",
  capabilities: {
    modes: ["text-to-video", "image-to-video", "extend"],
    maxRefs: 3,
    refRoles: ["first-frame", "identity", "style", "continuity"],
    durations: [5, 10],
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p", "1080p"],
    audio: false,
    negativePrompt: true,
    seed: false,
    maxCandidates: 1,
  },
  async generate(request, { signal, onProgress } = {}) {
    // Create and poll the provider job here. Forward AbortSignal to fetch.
    await onProgress?.({ phase: "queued", provider_job_id: "job_123" });
    const output = await providerGenerateAndWait(request, { signal, onProgress });
    return {
      videos: [{
        bytes: output.bytes,
        mime: "video/mp4",
        width: 1280,
        height: 720,
        duration: 5,
        fps: 24,
      }],
      provider_job_ids: ["job_123"],
      usage: { requests: 1, seconds_generated: 5, cost_usd: output.cost },
    };
  },
};

const agent = new Glove({
  store: new MemoryStore("video-studio"),
  model: createAdapter({ provider: "anthropic" }),
  displayManager: new Displaymanager(),
  systemPrompt: [
    "You are an autonomous video director. Own routine creative decisions.",
    "Treat every generated video as an internal draft.",
    "Review each draft, revise failures, and use the clip or flow delivery gate exactly once.",
    "Never present an unreviewed video.",
  ].join(" "),
  compaction_config: { compaction_instructions: "Summarize the video direction and asset ids." },
});

await mountVideo(agent, {
  adapter: videos,
  assets: new InMemoryVideoAssetStore(),
  library: new InMemoryVideoLibrary(),
  flows: new InMemoryVideoFlowStore(),
  review: {
    model: createAdapter({
      provider: "openrouter",
      model: "qwen/qwen3.5-flash-02-23",
      stream: false,
    }),
    store: new InMemoryVideoReviewStore(),
    passingScore: 82,
    rubric: "Presentation-ready, coherent motion, stable subject, no distracting artifacts.",
  },
  pipeline: [
    ...defaultVideoPipeline(),
    cameraDirective("deliberate dolly movement, motivated framing"),
    videoStyleDirective("naturalistic 35mm film, restrained contrast"),
  ],
  onProgress: (event) => console.log(event.phase, event.progress),
});

agent.build();
await agent.processRequest(
  "Save Mira as a recurring character, then create a two-shot arrival flow and run it.",
);
```

## Agentic review and delivery

Pass `review` to `mountVideo` to expose review-aware delivery tools:

1. `glove_video_review` sends the stored video bytes—not metadata or a
   thumbnail—to the configured video-capable `ModelAdapter`. It returns a
   scored pass/revise decision, timestamped evidence, issue severity, and a
   self-contained revision prompt.
2. `glove_video_deliver` refuses assets without a passing latest review. Only
   successful delivery includes user-facing video `renderData`.
3. `glove_video_flow_deliver` applies the same rule to every selected shot in
   a completed flow and accepts explicit reviewed replacements for revised
   shots. One failed or unreviewed scene holds the whole sequence.

With review enabled, generation, transformation, extension, and import results
are internal drafts: the agent receives their ids and lineage, but the host does
not render them. The primary agent remains in control of concepting, candidate
comparison, and whether to regenerate or transform; the reviewer supplies an
independent inspection of the actual clip. A declared pass below
`passingScore`, or one containing a major/critical issue, is normalized to
`revise`.

The reviewer receives identity, style, and first-frame images recorded in the
generation recipe alongside the clip. `glove_video_review.reference_assets`
can add evaluation-only images when the generation provider did not receive
them. This lets the reviewer verify recurring people, wardrobe, products, and
campaign style against visual anchors instead of a prose description alone.

Approval is deliberately a two-stage decision. The reviewer makes the creative
judgment and records its reasoning; Glove then applies a deterministic policy:

| Required condition | Why delivery is refused when it fails |
|---|---|
| `decision === "pass"` | The reviewer explicitly asked for another iteration. |
| `score >= passingScore` | The result missed the host application's stated quality bar. |
| No `major` or `critical` issue | A blocking defect cannot be averaged away by strengths elsewhere. |

Every rejected review preserves `summary`, `strengths`, structured `issues`
(`criterion`, `severity`, temporal `evidence`, and `fix`), and a self-contained
`revision_prompt`. This makes “do not submit” an auditable production decision,
not an unexplained model refusal. A failed review never includes render data;
`glove_video_deliver` checks the latest stored decision again before exposing
the bytes.

Use a separate reviewer adapter from the directing agent so review calls cannot
inherit or disturb the director's system prompt. Through OpenRouter, Glove core
formats `ContentPart.type === "video"` as the provider's native `video_url`
part. Other OpenAI-compatible providers retain their previous formatting.

### OpenRouter adapter

`openrouterVideo()` implements OpenRouter's asynchronous `/videos` API: it
submits a job, forwards progress, polls to a terminal state, downloads the
media bytes, and reports provider job ids and cost.

```ts
import { openrouterVideo } from "glove-video/openrouter";

const videos = openrouterVideo({
  // Defaults to process.env.OPENROUTER_API_KEY.
  // The default model is google/veo-3.1-lite.
  pollIntervalMs: 30_000,
});
```

The default model's capabilities are included. For another model, pass the
model's current `VideoModelCapabilities` from OpenRouter's
`GET /api/v1/videos/models` response. Requiring those capabilities avoids
silently using stale duration, resolution, reference-image, or audio limits.
First/last-frame references are sent as inline data URLs, so an in-memory
`glove-image` asset can feed image-to-video without separate object storage.

## Adapter contract

An adapter advertises capabilities up front. `fitVideoToModel()` clamps the
request to those capabilities and records every degradation in the recipe
trace. It never silently drops an unsupported duration, reference, negative
prompt, audio request, seed, aspect ratio, resolution, or candidate count.

```ts
interface VideoModelAdapter {
  name: string;
  capabilities: VideoModelCapabilities;
  generate(req: VideoGenerateRequest, ctx?: VideoCallContext): Promise<VideoModelResult>;
  extend?(req: VideoExtendRequest, ctx?: VideoCallContext): Promise<VideoModelResult>;
  transform?(req: VideoTransformRequest, ctx?: VideoCallContext): Promise<VideoModelResult>;
}
```

The promise resolves only when output bytes are available. A provider adapter
therefore owns:

1. request creation;
2. job polling or webhook coordination;
3. cancellation via `ctx.signal`;
4. progress events via `ctx.onProgress`;
5. downloading the final media before returning.

This keeps tool and flow behavior identical across synchronous and asynchronous
providers. Provider job ids may be returned for audit, but flow resume relies on
stored asset ids and checkpoints rather than an opaque provider job.

## References and `glove-image`

Video generation frequently consumes images. `MountVideoConfig.resolveReference`
is the bridge: reference ids can come from `glove-image`, the video asset store,
or a host-wide media store.

```ts
await mountVideo(agent, {
  // ...
  resolveReference: async (ref) => {
    if (ref.asset.startsWith("img_")) {
      const meta = await imageAssets.get(ref.asset);
      if (!meta) throw new Error(`Missing image ${ref.asset}`);
      return { bytes: await imageAssets.bytes(ref.asset), mime: meta.mime };
    }
    const meta = await videoAssets.get(ref.asset);
    if (!meta) throw new Error(`Missing video ${ref.asset}`);
    return { bytes: await videoAssets.bytes(ref.asset), mime: meta.mime };
  },
});
```

Without a custom resolver, references are resolved from the configured
`VideoAssetStore`.

## Prompt pipeline

A `VideoPromptDraft` preserves the raw `intent` while building `prompt`,
`negative`, structured `beats`, references, and model parameters. Built-ins:

| Enhancer | Behavior |
|---|---|
| `expandVideoCharacters()` | Splices appearance and performance wording verbatim, merges negatives, attaches identity/motion refs. |
| `expandVideoScenes()` | Adds setting and ambient motion, merges negatives, attaches style/continuity refs. |
| `expandVideoBeats()` | Sorts structured beats and renders an explicit seconds-based timeline. |
| `cameraDirective(text)` | Adds fixed camera direction. |
| `videoStyleDirective(text)` | Adds house visual style. |
| `videoNegativeDefaults(list)` | Merges standing negative constraints without duplicates. |
| `llmVideoEnhance(options)` | Optional LLM rewrite with usage accounting. |
| `fitVideoToModel()` | Terminal capability pass, always appended by `mountVideo`. |

The default pipeline contains the three expansion passes. Passing `pipeline`
replaces it; `fitVideoToModel()` still runs last.

## Multi-shot flows

A flow is a dependency graph of shots. `depends_on` establishes ordering.
`continuity` additionally feeds the first output from an earlier shot into the
next one:

```ts
const flow = {
  name: "market-arrival",
  shots: [
    {
      id: "wide",
      intent: "Wide view of Mira descending into the neon market",
      characters: ["mira"],
      scene: "neon-market",
      params: { duration: 5, aspectRatio: "16:9" },
    },
    {
      id: "follow",
      intent: "Follow Mira through the crowd without breaking the action",
      characters: ["mira"],
      scene: "neon-market",
      continuity: { from: "wide", mode: "extend" },
      params: { duration: 5 },
    },
    {
      id: "insert",
      intent: "Close insert of Mira's boots landing in a puddle",
      depends_on: ["wide"],
      continuity: { from: "wide", mode: "reference" },
    },
  ],
};
```

- `mode: "extend"` calls `adapter.extend` with the predecessor's bytes.
- `mode: "reference"` attaches the predecessor as a `continuity` reference.
- Definitions are validated for duplicate ids, missing dependencies, self
  references, and cycles before saving or running.
- Every run stores an immutable definition snapshot.
- State is persisted before and after every shot. `runVideoFlow(..., { runId })`
  and `glove_video_flow_resume` retry failed work but skip successful shots.
- Execution is stable and sequential. Candidate fan-out belongs inside a
  provider adapter; this avoids surprising concurrent spend.

## Tool inventory

| Tool | Purpose |
|---|---|
| `glove_video_generate` | Generate one or more video assets. |
| `glove_video_extend` | Continue a stored video from its ending. |
| `glove_video_transform` | Run video-to-video transformation. |
| `glove_video_regenerate` | Replay a generated recipe with an optional tweak. |
| `glove_video_review` | Watch actual video bytes and return a pass/revise decision with actionable evidence. |
| `glove_video_deliver` | Reveal one result only after its latest review passes. |
| `glove_video_flow_deliver` | Reveal a complete sequence only when every selected shot's latest review passes. |
| `glove_video_import` | Import video bytes or a URL. |
| `glove_video_asset_get` / `_list` | Inspect metadata and lineage without bytes in model context. |
| `glove_video_usage` | Report requests, tokens, generated seconds, and provider cost. |
| `glove_video_character_*` | Save/get/list/remove continuity-aware characters. |
| `glove_video_scene_*` | Save/get/list/remove reusable scenes. |
| `glove_video_flow_save` / `_get` / `_list` / `_remove` | Curate flow definitions. |
| `glove_video_flow_run` / `_resume` / `_status` | Execute and inspect checkpointed flow runs. |

`curate: false` removes character, scene, and flow-definition write tools. It
keeps generation and flow execution available. `requirePermission: true` gates
generation, extension, transformation, regeneration, flow run, and flow resume
through Glove's standard permission system.

## Storage and rendering

The in-memory stores are for tests and prototypes; video bytes make them a poor
production default. Implement `VideoAssetStore` over object storage and return a
short-lived signed URL from its optional `url(id)` method. Implement
`VideoReviewStore` in the same durable layer so approval history survives a
process restart. Tool `data` contains metadata, asset ids, and review evidence.
The signed URL is placed in `renderData` only after approval; Glove strips it
before model calls.

Flow definitions and run checkpoints belong in durable database storage in
production. Save operations should be atomic at the run-record level.

## Package exports

| Import | Contents |
|---|---|
| `glove-video` | Main barrel. |
| `glove-video/core` | Assets, library, model adapter, progress, usage, errors. |
| `glove-video/pipeline` | Drafts, enhancer contracts, and built-in enhancers. |
| `glove-video/flows` | Flow definitions, store contract, validator, and runner. |
| `glove-video/tools` | `mountVideo` and individual tool builders. |
| `glove-video/in-memory` | Reference asset, review, library, and flow stores. |

## Deliberate v0.1 boundaries

- The bundled provider surface is OpenRouter only. Additional providers should
  get focused adapters and live tests rather than a lowest-common-denominator
  HTTP wrapper.
- No ffmpeg composition. Use `glove-env-media` or a dedicated media service to
  concatenate, transcode, mix audio, or extract first/last frames.
- No automatic final-frame extraction for continuity. `extend` passes the source
  video; `reference` passes the predecessor asset through the resolver.
- No parallel flow execution. Stable sequential execution makes cost, ordering,
  and resume behavior obvious in the first contract.
- No React renderer yet. `renderData` already has stable `video`,
  `video-gallery`, and `video-flow` shapes for a future renderer package.
