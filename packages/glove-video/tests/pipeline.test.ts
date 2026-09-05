import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelAdapter } from "glove-core";
import {
  type VideoModelCapabilities,
  VideoCharacterNotFoundError,
} from "../src/core/index";
import { InMemoryVideoAssetStore, InMemoryVideoLibrary } from "../src/in-memory/index";
import {
  cameraDirective,
  createVideoDraft,
  expandVideoBeats,
  expandVideoCharacters,
  expandVideoScenes,
  fitVideoToModel,
  llmVideoEnhance,
  runVideoPipeline,
  videoNegativeDefaults,
} from "../src/pipeline/index";

const capabilities: VideoModelCapabilities = {
  modes: ["text-to-video", "image-to-video"],
  maxRefs: 2,
  refRoles: ["first-frame", "identity", "style"],
  durations: [4, 6, 8],
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p"],
  audio: false,
  negativePrompt: false,
  seed: false,
  maxCandidates: 2,
};

async function library(): Promise<InMemoryVideoLibrary> {
  const value = new InMemoryVideoLibrary();
  await value.saveCharacter({
    name: "mira",
    appearance: "a wiry sky-courier in a patched blue flight jacket",
    performance: "quick, precise gestures and a wary glance",
    negative: "no goggles",
    refs: [{ asset: "mira-face", role: "identity" }],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  await value.saveScene({
    name: "night-market",
    setting: "a rain-slicked neon market with magenta and teal practical light",
    ambient_motion: "steam curls from stalls while awnings flutter",
    negative: "no daylight",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  return value;
}

function context(value: InMemoryVideoLibrary, model?: ModelAdapter) {
  return {
    library: value,
    assets: new InMemoryVideoAssetStore(),
    capabilities,
    model,
  };
}

test("video prompt pipeline expands identity, setting, motion, and timed beats", async () => {
  const lib = await library();
  const output = await runVideoPipeline(
    createVideoDraft({
      intent: "Mira lands beside a food stall",
      characters: ["mira"],
      scene: "night-market",
      beats: [
        { at: 3, action: "Mira touches down" },
        { at: 0, action: "Camera tracks through steam" },
      ],
    }),
    [expandVideoCharacters(), expandVideoScenes(), expandVideoBeats()],
    context(lib),
  );

  assert.equal(output.intent, "Mira lands beside a food stall");
  assert.match(output.prompt, /patched blue flight jacket/);
  assert.match(output.prompt, /quick, precise gestures/);
  assert.match(output.prompt, /rain-slicked neon market/);
  assert.match(output.prompt, /Ambient motion: steam curls/);
  assert.ok(output.prompt.indexOf("0.0s") < output.prompt.indexOf("3.0s"));
  assert.equal(output.negative, "no goggles, no daylight");
  assert.deepEqual(output.refs, [{ asset: "mira-face", role: "identity" }]);
  assert.deepEqual(output.trace.map((entry) => entry.enhancer), [
    "expand-characters",
    "expand-scenes",
    "expand-beats",
  ]);
});

test("missing characters are explicit instead of silently drifting", async () => {
  const lib = await library();
  await assert.rejects(
    runVideoPipeline(
      createVideoDraft({ intent: "A person walks", characters: ["ghost"] }),
      [expandVideoCharacters()],
      context(lib),
    ),
    (error: Error) => {
      assert.ok(error instanceof VideoCharacterNotFoundError);
      assert.match(error.message, /ghost/);
      assert.match(error.message, /mira/);
      return true;
    },
  );
});

test("fitVideoToModel degrades unsupported requests visibly", async () => {
  const lib = await library();
  const output = await runVideoPipeline(
    createVideoDraft({
      intent: "x",
      negative: "watermark",
      refs: [
        { asset: "style", role: "style" },
        { asset: "source", role: "source" },
        { asset: "face", role: "identity" },
        { asset: "opening", role: "first-frame" },
      ],
      beats: [{ at: 9, action: "too late" }],
      params: {
        duration: 7,
        aspectRatio: "4:3",
        resolution: "4k",
        seed: 9,
        candidates: 5,
        audio: true,
      },
    }),
    [fitVideoToModel()],
    context(lib),
  );

  assert.equal(output.negative, undefined);
  assert.match(output.prompt, /Avoid: watermark/);
  assert.deepEqual(output.refs, [
    { asset: "face", role: "identity" },
    { asset: "opening", role: "first-frame" },
  ]);
  assert.equal(output.params.duration, 6);
  assert.equal(output.params.aspectRatio, "16:9");
  assert.equal(output.params.resolution, "720p");
  assert.equal(output.params.seed, undefined);
  assert.equal(output.params.candidates, 2);
  assert.equal(output.params.audio, false);
  assert.equal(output.beats.length, 0);
  const note = output.trace[0]!.note ?? "";
  assert.match(note, /Dropped 1 unsupported/);
  assert.match(note, /Clamped references/);
  assert.match(note, /Duration snapped/);
  assert.match(note, /Dropped 1 beat/);
});

test("directives compose and the LLM enhancer reports usage", async () => {
  const lib = await library();
  const model: ModelAdapter = {
    name: "fake",
    async prompt() {
      return {
        messages: [{ sender: "agent", text: "rewritten temporal prompt" }],
        tokens_in: 20,
        tokens_out: 8,
      };
    },
    setSystemPrompt() {},
  };
  const usage: Array<Record<string, unknown>> = [];
  const output = await runVideoPipeline(
    createVideoDraft({ intent: "x", negative: "watermark" }),
    [
      cameraDirective("slow handheld push-in"),
      videoNegativeDefaults(["watermark", "flicker"]),
      llmVideoEnhance(),
    ],
    { ...context(lib, model), recordUsage: (value) => usage.push(value) },
  );
  assert.equal(output.prompt, "rewritten temporal prompt");
  assert.equal(output.negative, "watermark, flicker");
  assert.deepEqual(usage, [{ requests: 1, tokens_in: 20, tokens_out: 8 }]);
});
