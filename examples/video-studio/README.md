# video-studio

A runnable, agent-owned `glove-image` → `glove-video` production loop. A Glove
agent develops the concept, creates and visually inspects its keyframe, animates
it, watches every resulting video through an independent video-capable reviewer,
revises failed drafts, and reveals only the strongest passing result.

The bundled `localFfmpegVideo()` example adapter is deliberately deterministic:
it exercises the complete adapter, tool, asset, progress, and flow contracts
without pretending ffmpeg is a generative model. `glove-video` also ships the
hosted `openrouterVideo()` adapter. Glove core's OpenRouter-compatible formatter
supports native `video_url` content so the reviewer receives video rather than
an image-shaped placeholder.

## Verify without network access

Requires `ffmpeg` and `ffprobe` on `PATH` (or set `FFMPEG_PATH` and
`FFPROBE_PATH`).

```bash
pnpm --filter glove-video-studio test
pnpm --filter glove-video-studio selfcheck
```

The self-check covers text-to-video, image-to-video, video-to-video, extension,
ordered progress events, capability fitting, a checkpointed two-shot flow, and
the draft review/delivery gate.
Generated files are written to `out/selfcheck/` for inspection.

## Exercise the real Glove agent and `glove-image`

```bash
OPENROUTER_API_KEY=... pnpm --filter glove-video-studio selfcheck:live
```

This live check requires the agent to call `glove_image_generate`, inspect the
keyframe, call the OpenRouter-backed `glove_video_generate`, review the actual
MP4, and call `glove_video_deliver`. It verifies the complete tool sequence and
probes the approved result. The selected low-resolution model incurs an API
charge, and a failed review can trigger a bounded second generation.

For an interactive session:

```bash
OPENROUTER_API_KEY=... pnpm --filter glove-video-studio start
```

Try: `Make me a memorable six-second cinematic micro-story. Choose the subject and deliver only a result you have reviewed.`

To have the same Glove agent watch and compare existing local candidates:

```bash
VIDEO_BRIEF="the complete intended viewer experience" \
OPENROUTER_API_KEY=... \
pnpm --filter glove-video-studio run audit -- candidate-a.mp4 candidate-b.mp4
```

The command fails if the agent skips any supplied video, and the delivery tool
still refuses a candidate without a passing latest review.

## Cinematic showcase

The showcase gives the creative agent an outcome, not a hardcoded shot prompt.
It chooses the subject and direction, inspects the keyframe, generates a
six-second sound-enabled video, reviews the actual result, revises if necessary,
and invokes the delivery gate:

```bash
OPENROUTER_API_KEY=... pnpm --filter glove-video-studio showcase
```

Only the approved `agentic-final.mp4`, its selected keyframe, and a manifest
containing the complete review history and usage are written to `out/showcase/`.

## Recorded gallery review method

The site case study uses `sampledVideoReviewModel` when native video input is
unavailable. It decodes the actual stored MP4 at two frames per second and adds
an audio-amplitude waveform spanning the complete clip. The reviewer receives
the samples in chronological order and is instructed to cite visible timing or
continuity evidence, while avoiding semantic claims that a waveform cannot
support. The resulting score, blockers, evidence, fixes, revision prompt, and
reviewer identity are exported with every take for the gallery decision ledger.

The example defaults to Chinese OpenRouter models for control and inspection:
Qwen 3.5 Plus directs the tool loop and Qwen 3.5 Flash reviews chronological
video samples. Override `GALLERY_DIRECTOR_MODEL`, `GALLERY_REVIEW_MODEL`,
`BRAND_DIRECTOR_MODEL`, or `BRAND_REVIEW_MODEL` to test another compatible
model. DeepSeek's general chat models are text-only; do not select one as the
reviewer unless the specific model advertises image or video input.

## Recurring-model campaign case study

The `/docs/video/gallery` artifact was produced by the brand runners. The first
runner gives the agent the outcome—one fictional fashion model across three
brand scenes—and lets it create the identity images, character definition,
locations, flow, timed performances, reviews, and revisions:

```bash
OPENROUTER_API_KEY=... pnpm --filter glove-video-studio brand-gallery
```

The recorded run then exercises capability-driven fallback and finishing passes
with `brand-recover`, `brand-veo`, and `brand-finish`. Those scripts exist to
replay the exact bounded case study, not as a recommended retry strategy for
every application. Their output is written to `out/brand-gallery/` and the site
data module.

For recurring people or products, the reviewer receives the identity/style
images used by the generation recipe. `glove_video_review` also accepts
`reference_assets` when an evaluation anchor was not sent to the generator.
For a flow, `glove_video_flow_deliver` validates the latest review for every
selected shot and refuses the entire sequence if any shot is missing, failed,
or replaced by an unreviewed revision.
