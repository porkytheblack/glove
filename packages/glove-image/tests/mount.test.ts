import { test } from "node:test";
import assert from "node:assert/strict";
import type { GloveFoldArgs, ToolResultData } from "glove-core";
import {
  type ImageModelAdapter,
  type ImageGenerateRequest,
  type ImageUsage,
  type UsageSource,
  UsageMeter,
} from "../src/core/index";
import { InMemoryImageAssetStore, InMemoryImageLibrary } from "../src/in-memory/index";
import { mountImage, type ImageMountTarget } from "../src/tools/index";
import { PNG_1x1 } from "./stores.test";

class FakeGlove implements ImageMountTarget {
  tools = new Map<string, GloveFoldArgs<any>>();
  fold<I>(args: GloveFoldArgs<I>) {
    this.tools.set(args.name, args as GloveFoldArgs<any>);
    return this;
  }
  async run(name: string, input: unknown): Promise<ToolResultData> {
    const tool = this.tools.get(name);
    assert.ok(tool, `tool ${name} not folded`);
    if (tool.inputSchema) {
      const parsed = tool.inputSchema.safeParse(input);
      assert.ok(parsed.success, `input invalid for ${name}: ${JSON.stringify(parsed.error?.issues)}`);
      input = parsed.data;
    }
    return tool.do(input, undefined as any, undefined as any, undefined);
  }
}

function fakeAdapter(log: ImageGenerateRequest[] = []): ImageModelAdapter {
  return {
    name: "fake-model",
    capabilities: {
      modes: ["generate", "edit"],
      maxRefs: 2,
      refRoles: ["identity", "style", "content", "mask"],
      sizes: ["512x512"],
      negativePrompt: false,
      seed: false,
      maxCandidates: 2,
    },
    async generate(req) {
      log.push(req);
      const n = Math.max(1, req.candidates ?? 1);
      return {
        images: Array.from({ length: n }, () => ({ bytes: PNG_1x1, mime: "image/png" })),
        usage: { requests: n, tokens_in: 10 * n, tokens_out: 1000 * n, cost_usd: 0.03 * n },
      };
    },
    async edit() {
      return {
        images: [{ bytes: PNG_1x1, mime: "image/png" }],
        usage: { requests: 1, tokens_in: 15, tokens_out: 1200, cost_usd: 0.04 },
      };
    },
  };
}

async function setup(opts: { curate?: boolean } = {}) {
  const glove = new FakeGlove();
  const assets = new InMemoryImageAssetStore();
  const library = new InMemoryImageLibrary();
  const log: ImageGenerateRequest[] = [];
  const meter = new UsageMeter();
  const usageEvents: Array<{ source: UsageSource; usage: ImageUsage }> = [];
  await mountImage(glove, {
    adapter: fakeAdapter(log),
    assets,
    library,
    curate: opts.curate,
    usage: meter,
    onUsage: (source, usage) => usageEvents.push({ source, usage }),
  });
  return { glove, assets, library, log, meter, usageEvents };
}

test("mountImage folds the full surface; curate:false drops library writes", async () => {
  const { glove } = await setup();
  const names = [...glove.tools.keys()];
  for (const expected of [
    "glove_image_generate",
    "glove_image_edit",
    "glove_image_regenerate",
    "glove_image_import",
    "glove_image_describe",
    "glove_image_asset_list",
    "glove_image_assemble",
    "glove_image_character_save",
    "glove_image_scene_save",
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }

  const readOnly = await setup({ curate: false });
  assert.ok(!readOnly.glove.tools.has("glove_image_character_save"));
  assert.ok(!readOnly.glove.tools.has("glove_image_scene_remove"));
  assert.ok(readOnly.glove.tools.has("glove_image_character_list"));
});

test("generate: expands a saved character, stores assets with recipe, reports degradations", async () => {
  const { glove, assets, log } = await setup();
  await glove.run("glove_image_character_save", {
    name: "mira",
    appearance: "a wiry sky-courier in her 20s with a patched flight jacket",
    negative: "no goggles",
  });

  const result = await glove.run("glove_image_generate", {
    intent: "Mira landing at a night market",
    characters: ["mira"],
    negative: "blurry",
    size: "9999x9999",
    candidates: 5,
  });
  assert.equal(result.status, "success");
  const data = result.data as any;
  // candidates clamped 5 → 2 by fitToModel.
  assert.equal(data.assets.length, 2);
  assert.ok(data.degradations.some((d: string) => /snapped/.test(d)));
  assert.ok(data.degradations.some((d: string) => /Candidates clamped/.test(d)));

  // The adapter saw the expanded prompt with negatives folded in.
  const req = log[0]!;
  assert.match(req.prompt, /patched flight jacket/);
  assert.match(req.prompt, /Avoid: blurry, no goggles/);
  assert.equal(req.negative, undefined);
  assert.equal(req.size, "512x512");

  // Stored with lineage.
  const stored = await assets.get(data.assets[0].id);
  assert.equal(stored?.source, "generated");
  assert.equal(stored?.recipe?.kind, "generated");
  assert.equal(stored?.recipe?.intent, "Mira landing at a night market");
  assert.deepEqual(stored?.recipe?.characters, ["mira"]);
  assert.ok(stored?.recipe?.trace!.length! > 0);
  assert.equal(stored?.width, 1); // sniffed from bytes

  // renderData carries thumbnails; data does not carry bytes.
  assert.ok((result.renderData as any).images[0].dataUrl.startsWith("data:image/png"));
  assert.ok(!JSON.stringify(result.data).includes("base64"));
});

test("generate: unknown character is a tool error naming what exists", async () => {
  const { glove } = await setup();
  const result = await glove.run("glove_image_generate", {
    intent: "x",
    characters: ["ghost"],
  });
  assert.equal(result.status, "error");
  assert.match(result.message!, /ghost/);
  assert.match(result.message!, /no characters yet/);
});

test("regenerate replays the recipe with a tweak appended to the intent", async () => {
  const { glove, assets, log } = await setup();
  await glove.run("glove_image_character_save", {
    name: "mira",
    appearance: "a wiry sky-courier in her 20s",
  });
  const first = await glove.run("glove_image_generate", {
    intent: "Mira at the harbor",
    characters: ["mira"],
  });
  const firstId = (first.data as any).assets[0].id;

  const second = await glove.run("glove_image_regenerate", {
    asset: firstId,
    tweak: "at dusk",
  });
  assert.equal(second.status, "success");
  const newAsset = await assets.get((second.data as any).assets[0].id);
  assert.equal(newAsset?.recipe?.intent, "Mira at the harbor. at dusk");
  // Character expansion re-ran against the live library.
  assert.match(log[log.length - 1]!.prompt, /wiry sky-courier/);

  // Regenerating an import is refused.
  const imported = await glove.run("glove_image_import", {
    data: Buffer.from(PNG_1x1).toString("base64"),
  });
  const refusal = await glove.run("glove_image_regenerate", {
    asset: (imported.data as any).id,
  });
  assert.equal(refusal.status, "error");
  assert.match(refusal.message!, /no generation recipe/);
});

test("import: base64 data is sniffed and stored; url+data together refused", async () => {
  const { glove } = await setup();
  const result = await glove.run("glove_image_import", {
    data: Buffer.from(PNG_1x1).toString("base64"),
    name: "seed",
  });
  assert.equal(result.status, "success");
  const data = result.data as any;
  assert.equal(data.mime, "image/png");
  assert.equal(data.width, 1);
  assert.equal(data.source, "imported");

  const both = await glove.run("glove_image_import", {
    url: "https://example.com/x.png",
    data: "abc",
  });
  assert.equal(both.status, "error");
});

test("edit: stores result with parent lineage", async () => {
  const { glove, assets } = await setup();
  const imported = await glove.run("glove_image_import", {
    data: Buffer.from(PNG_1x1).toString("base64"),
  });
  const baseId = (imported.data as any).id;
  const edited = await glove.run("glove_image_edit", {
    asset: baseId,
    instruction: "make it blue",
  });
  assert.equal(edited.status, "success");
  const meta = await assets.get((edited.data as any).assets[0].id);
  assert.equal(meta?.source, "edited");
  assert.equal(meta?.recipe?.parent, baseId);
  assert.equal(meta?.recipe?.finalPrompt, "make it blue");
});

test("describe and asset_list expose metadata, never bytes", async () => {
  const { glove } = await setup();
  const imported = await glove.run("glove_image_import", {
    data: Buffer.from(PNG_1x1).toString("base64"),
    name: "dot",
    tags: ["seed"],
  });
  const id = (imported.data as any).id;

  const described = await glove.run("glove_image_describe", { asset: id });
  assert.equal(described.status, "success");
  assert.equal((described.data as any).name, "dot");
  assert.ok(!JSON.stringify(described.data).includes("base64"));

  const listed = await glove.run("glove_image_asset_list", { tags: ["seed"] });
  assert.equal((listed.data as any).count, 1);
});

test("character save preserves created_at on upsert and enforces kebab-case", async () => {
  const { glove, library } = await setup();
  await glove.run("glove_image_character_save", { name: "mira", appearance: "a wiry sky-courier" });
  const first = await library.getCharacter("mira");
  await new Promise((r) => setTimeout(r, 5));
  await glove.run("glove_image_character_save", { name: "mira", appearance: "a wiry sky-courier, older now" });
  const second = await library.getCharacter("mira");
  assert.equal(second?.created_at, first?.created_at);
  assert.notEqual(second?.updated_at, first?.updated_at);

  const tool = (glove as any).tools.get("glove_image_character_save");
  const bad = tool.inputSchema.safeParse({ name: "Not Kebab", appearance: "long enough here" });
  assert.equal(bad.success, false);
});

test("usage: per-call cost lands in data + recipe, aggregates on the meter, fires onUsage", async () => {
  const { glove, assets, meter, usageEvents } = await setup();

  const gen = await glove.run("glove_image_generate", { intent: "a lighthouse", candidates: 2 });
  assert.equal(gen.status, "success");
  const callUsage = (gen.data as any).usage as ImageUsage;
  // Fake adapter reports per-candidate usage: 2 requests, 0.06 USD.
  assert.equal(callUsage.requests, 2);
  assert.equal(callUsage.tokens_out, 2000);
  assert.ok(Math.abs((callUsage.cost_usd ?? 0) - 0.06) < 1e-9);

  // Recipe pins the whole-call spend to the asset.
  const stored = await assets.get((gen.data as any).assets[0].id);
  assert.equal(stored?.recipe?.usage?.requests, 2);

  // Edit adds its own spend under a separate source.
  const imported = await glove.run("glove_image_import", {
    data: Buffer.from(PNG_1x1).toString("base64"),
  });
  const edited = await glove.run("glove_image_edit", {
    asset: (imported.data as any).id,
    instruction: "bluer",
  });
  assert.equal((edited.data as any).usage.cost_usd, 0.04);
  const editedMeta = await assets.get((edited.data as any).assets[0].id);
  assert.equal(editedMeta?.recipe?.usage?.tokens_out, 1200);

  // Meter aggregates across calls with per-source attribution...
  const report = meter.report();
  assert.equal(report.total.requests, 3);
  assert.equal(report.total.tokens_out, 3200);
  assert.ok(Math.abs((report.total.cost_usd ?? 0) - 0.1) < 1e-9);
  assert.equal(report.by_source.generate!.requests, 2);
  assert.equal(report.by_source.edit!.requests, 1);

  // ...the agent can read the same report through the tool...
  const toolReport = await glove.run("glove_image_usage", {});
  assert.deepEqual((toolReport.data as any).total, report.total);

  // ...and the host callback saw every spend event with its source.
  assert.deepEqual(
    usageEvents.map((e) => e.source),
    ["generate", "edit"],
  );
});

test("assemble composites layers onto a canvas (sharp present in workspace)", async (t) => {
  let sharpAvailable = true;
  try {
    await import("sharp");
  } catch {
    sharpAvailable = false;
  }
  if (!sharpAvailable) {
    t.skip("sharp not installed");
    return;
  }
  const { glove } = await setup();
  const imported = await glove.run("glove_image_import", {
    data: Buffer.from(PNG_1x1).toString("base64"),
  });
  const id = (imported.data as any).id;
  const result = await glove.run("glove_image_assemble", {
    canvas: { width: 64, height: 32, background: "#000000" },
    layers: [
      { asset: id, x: 0, y: 0, width: 32, height: 32 },
      { asset: id, x: 32, y: 0, width: 32, height: 32, opacity: 0.5 },
    ],
    name: "sheet",
  });
  assert.equal(result.status, "success");
  const data = result.data as any;
  assert.equal(data.width, 64);
  assert.equal(data.height, 32);
  assert.equal(data.source, "assembled");
});
