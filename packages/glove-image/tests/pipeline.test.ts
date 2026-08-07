import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelAdapter } from "glove-core";
import {
  createDraft,
  runPipeline,
  expandCharacters,
  expandScenes,
  styleDirective,
  negativeDefaults,
  llmEnhance,
  fitToModel,
} from "../src/pipeline/index";
import {
  ImageCharacterNotFoundError,
  type ImageModelCapabilities,
} from "../src/core/index";
import { InMemoryImageAssetStore, InMemoryImageLibrary } from "../src/in-memory/index";

const caps: ImageModelCapabilities = {
  modes: ["generate"],
  maxRefs: 2,
  refRoles: ["identity", "style", "content"],
  sizes: ["512x512", "1024x1024"],
  negativePrompt: false,
  seed: false,
  maxCandidates: 2,
};

function ctx(
  library: InMemoryImageLibrary,
  model?: ModelAdapter,
): Parameters<typeof runPipeline>[2] {
  return {
    library,
    assets: new InMemoryImageAssetStore(),
    model,
    capabilities: caps,
  };
}

async function seededLibrary(): Promise<InMemoryImageLibrary> {
  const library = new InMemoryImageLibrary();
  await library.saveCharacter({
    name: "mira",
    display_name: "Mira",
    appearance: "a wiry sky-courier in her 20s with a patched flight jacket",
    negative: "no goggles",
    ref_images: [{ asset: "img_ref1" }, { asset: "img_ref2" }, { asset: "img_ref3" }],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  await library.saveScene({
    name: "neon-market",
    setting: "a rain-slicked neon night market, magenta and teal signage",
    negative: "no daylight",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  return library;
}

test("expandCharacters splices appearance verbatim, merges negative, attaches identity refs", async () => {
  const library = await seededLibrary();
  const draft = createDraft({ intent: "Mira landing", characters: ["mira"] });
  const out = await runPipeline(draft, [expandCharacters()], ctx(library));

  assert.match(out.positive, /a wiry sky-courier in her 20s with a patched flight jacket/);
  assert.equal(out.intent, "Mira landing"); // intent never mutated
  assert.equal(out.negative, "no goggles");
  assert.equal(out.characters.length, 1);
  assert.equal(out.refs.length, 3);
  assert.ok(out.refs.every((r) => r.role === "identity"));
  assert.equal(out.trace.length, 1);
  assert.equal(out.trace[0]!.enhancer, "expand-characters");
});

test("expandCharacters throws a clear error for a missing name", async () => {
  const library = await seededLibrary();
  const draft = createDraft({ intent: "x", characters: ["ghost"] });
  await assert.rejects(
    runPipeline(draft, [expandCharacters()], ctx(library)),
    (err: Error) => {
      assert.ok(err instanceof ImageCharacterNotFoundError);
      assert.match(err.message, /ghost/);
      assert.match(err.message, /mira/); // names what IS available
      return true;
    },
  );
});

test("expandScenes splices setting and merges negative without clobbering", async () => {
  const library = await seededLibrary();
  const draft = createDraft({ intent: "x", scene: "neon-market", negative: "no goggles" });
  const out = await runPipeline(draft, [expandScenes()], ctx(library));
  assert.match(out.positive, /rain-slicked neon night market/);
  assert.equal(out.negative, "no goggles, no daylight");
});

test("styleDirective and negativeDefaults compose; duplicates are not re-added", async () => {
  const library = await seededLibrary();
  const draft = createDraft({ intent: "x", negative: "watermark" });
  const out = await runPipeline(
    draft,
    [styleDirective("gouache, muted palette"), negativeDefaults(["watermark", "extra fingers"])],
    ctx(library),
  );
  assert.match(out.positive, /Style: gouache, muted palette/);
  assert.equal(out.negative, "watermark, extra fingers");
});

test("llmEnhance rewrites via the model, records usage, and notes it; skips without a model", async () => {
  const library = await seededLibrary();
  const fakeModel: ModelAdapter = {
    name: "fake",
    async prompt() {
      return { messages: [{ sender: "agent", text: "REWRITTEN PROMPT" }], tokens_in: 120, tokens_out: 40 };
    },
    setSystemPrompt() {},
  };
  const recorded: Array<Record<string, unknown>> = [];
  const withModel = await runPipeline(createDraft({ intent: "x" }), [llmEnhance()], {
    ...ctx(library, fakeModel),
    recordUsage: (u) => recorded.push(u as Record<string, unknown>),
  });
  assert.equal(withModel.positive, "REWRITTEN PROMPT");
  assert.match(withModel.trace[0]!.note ?? "", /Rewritten/);
  assert.deepEqual(recorded, [{ requests: 1, tokens_in: 120, tokens_out: 40 }]);

  const without = await runPipeline(createDraft({ intent: "x" }), [llmEnhance()], ctx(library));
  assert.equal(without.positive, "x");
  assert.match(without.trace[0]!.note ?? "", /no LLM/);
});

test("fitToModel folds negative, clamps refs identity-first, snaps size, clamps candidates", async () => {
  const library = await seededLibrary();
  const draft = createDraft({
    intent: "x",
    negative: "blurry",
    refs: [
      { asset: "a", role: "style" },
      { asset: "b", role: "identity" },
      { asset: "c", role: "composition" }, // unsupported role for caps above? composition IS unsupported here
      { asset: "d", role: "identity" },
    ],
    params: { size: "768x768", candidates: 5, seed: 42 },
  });
  const out = await runPipeline(draft, [fitToModel()], ctx(library));

  assert.equal(out.negative, undefined);
  assert.match(out.positive, /Avoid: blurry/);
  // "composition" not in refRoles → dropped; then clamp to maxRefs=2 keeping identity first.
  assert.equal(out.refs.length, 2);
  assert.ok(out.refs.every((r) => r.role === "identity"));
  assert.equal(out.params.size, "512x512");
  assert.equal(out.params.candidates, 2);
  assert.equal(out.params.seed, undefined);
  const note = out.trace[0]!.note ?? "";
  assert.match(note, /folded/i);
  assert.match(note, /Clamped refs/);
  assert.match(note, /snapped/);
});

test("trace records a snapshot per stage in order", async () => {
  const library = await seededLibrary();
  const out = await runPipeline(
    createDraft({ intent: "x", characters: ["mira"], scene: "neon-market" }),
    [expandCharacters(), expandScenes(), styleDirective("ink wash"), fitToModel()],
    ctx(library),
  );
  assert.deepEqual(
    out.trace.map((t) => t.enhancer),
    ["expand-characters", "expand-scenes", "style-directive", "fit-to-model"],
  );
  for (const entry of out.trace) assert.ok(entry.positive_after.length > 0);
});
