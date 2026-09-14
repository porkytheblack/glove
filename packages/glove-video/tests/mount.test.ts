import { test } from "node:test";
import assert from "node:assert/strict";
import type { GloveFoldArgs, ModelAdapter, PromptRequest, ToolResultData } from "glove-core";
import {
  type VideoGenerateRequest,
  type VideoModelAdapter,
  type VideoProgress,
  type VideoUsage,
  type VideoUsageSource,
  VideoUsageMeter,
} from "../src/core/index";
import {
  InMemoryVideoAssetStore,
  InMemoryVideoFlowStore,
  InMemoryVideoLibrary,
  InMemoryVideoReviewStore,
} from "../src/in-memory/index";
import { mountVideo, type VideoMountTarget } from "../src/tools/index";

const VIDEO = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);

class FakeGlove implements VideoMountTarget {
  tools = new Map<string, GloveFoldArgs<any>>();

  fold<I>(tool: GloveFoldArgs<I>) {
    this.tools.set(tool.name, tool as GloveFoldArgs<any>);
    return this;
  }

  async run(name: string, input: unknown): Promise<ToolResultData> {
    const tool = this.tools.get(name);
    assert.ok(tool, `tool ${name} not mounted`);
    if (tool.inputSchema) {
      const parsed = tool.inputSchema.safeParse(input);
      assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
      input = parsed.data;
    }
    return tool.do(input, undefined as never, undefined as never, undefined);
  }
}

interface AdapterLog {
  generate: VideoGenerateRequest[];
  extend: VideoGenerateRequest[];
  transform: VideoGenerateRequest[];
}

function adapter(log: AdapterLog): VideoModelAdapter {
  const result = (duration?: number) => ({
    videos: [
      {
        bytes: VIDEO,
        mime: "video/mp4",
        width: 1280,
        height: 720,
        duration: duration ?? 5,
        fps: 24,
      },
    ],
    usage: { requests: 1, seconds_generated: duration ?? 5, cost_usd: 0.5 },
    provider_job_ids: ["job-1"],
  });
  return {
    name: "fake-video",
    capabilities: {
      modes: ["text-to-video", "image-to-video", "video-to-video", "extend"],
      maxRefs: 3,
      refRoles: ["first-frame", "identity", "style", "continuity"],
      durations: [5, 10],
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p"],
      audio: false,
      negativePrompt: false,
      seed: false,
      maxCandidates: 1,
    },
    async generate(req, ctx) {
      log.generate.push(req);
      await ctx?.onProgress?.({ phase: "queued", progress: 0, provider_job_id: "job-1" });
      await ctx?.onProgress?.({ phase: "generating", progress: 0.5, provider_job_id: "job-1" });
      return result(req.params.duration);
    },
    async extend(req) {
      log.extend.push(req);
      return result(req.params.duration);
    },
    async transform(req) {
      log.transform.push(req);
      return result(req.params.duration);
    },
  };
}

async function setup(curate = true, reviewer?: ModelAdapter) {
  const glove = new FakeGlove();
  const assets = new InMemoryVideoAssetStore();
  const library = new InMemoryVideoLibrary();
  const flows = new InMemoryVideoFlowStore();
  const log: AdapterLog = { generate: [], extend: [], transform: [] };
  const meter = new VideoUsageMeter();
  const reviews = new InMemoryVideoReviewStore();
  const usage: Array<{ source: VideoUsageSource; usage: VideoUsage }> = [];
  const progress: Array<VideoProgress & { operation: string }> = [];
  await mountVideo(glove, {
    adapter: adapter(log),
    assets,
    library,
    flows,
    curate,
    usage: meter,
    onUsage: (source, value) => usage.push({ source, usage: value }),
    onProgress: (event) => {
      progress.push(event);
    },
    review: reviewer ? { model: reviewer, store: reviews, passingScore: 80 } : undefined,
    resolveReference: async (ref) => ({
      bytes: ref.asset === "image-ref" ? new Uint8Array([9, 9]) : await assets.bytes(ref.asset),
      mime: ref.asset === "image-ref" ? "image/png" : "video/mp4",
    }),
  });
  return { glove, assets, library, flows, reviews, log, meter, usage, progress };
}

function queuedReviewer(responses: string[], requests: PromptRequest[]): ModelAdapter {
  return {
    name: "fake-video-reviewer",
    setSystemPrompt() {},
    async prompt(request) {
      requests.push(request);
      const text = responses.shift();
      assert.ok(text, "fake reviewer ran out of responses");
      return {
        messages: [{ sender: "agent", text }],
        tokens_in: 20,
        tokens_out: 10,
      };
    },
  };
}

test("mountVideo exposes generation, assets, continuity libraries, and flows", async () => {
  const { glove } = await setup();
  for (const name of [
    "glove_video_generate",
    "glove_video_extend",
    "glove_video_transform",
    "glove_video_regenerate",
    "glove_video_import",
    "glove_video_asset_get",
    "glove_video_usage",
    "glove_video_character_save",
    "glove_video_scene_save",
    "glove_video_flow_save",
    "glove_video_flow_run",
    "glove_video_flow_resume",
  ]) {
    assert.ok(glove.tools.has(name), `missing ${name}`);
  }

  const readOnly = await setup(false);
  assert.ok(!readOnly.glove.tools.has("glove_video_character_save"));
  assert.ok(!readOnly.glove.tools.has("glove_video_flow_save"));
  assert.ok(readOnly.glove.tools.has("glove_video_flow_run"));
  assert.ok(readOnly.glove.tools.has("glove_video_character_list"));
});

test("generate resolves external image refs, fits capabilities, and records lineage and progress", async () => {
  const { glove, assets, log, meter, progress } = await setup();
  await glove.run("glove_video_character_save", {
    name: "mira",
    appearance: "a sky-courier in a patched blue flight jacket",
    refs: [{ asset: "image-ref", role: "identity" }],
  });
  const result = await glove.run("glove_video_generate", {
    intent: "Mira lands on a rooftop",
    characters: ["mira"],
    duration: 7,
    aspect_ratio: "4:3",
    candidates: 3,
    audio: true,
    negative: "flicker",
    name: "arrival",
  });
  assert.equal(result.status, "success");
  const data = result.data as any;
  assert.equal(data.assets.length, 1);
  assert.ok(data.degradations.some((value: string) => /Duration snapped/.test(value)));
  assert.equal(log.generate[0]!.params.duration, 5);
  assert.equal(log.generate[0]!.params.aspectRatio, "16:9");
  assert.equal(log.generate[0]!.params.candidates, 1);
  assert.equal(log.generate[0]!.params.audio, false);
  assert.equal(log.generate[0]!.refs[0]!.mime, "image/png");
  assert.match(log.generate[0]!.prompt, /patched blue flight jacket/);
  assert.match(log.generate[0]!.prompt, /Avoid: flicker/);

  const stored = await assets.get(data.assets[0].id);
  assert.equal(stored?.source, "generated");
  assert.equal(stored?.recipe?.kind, "generated");
  assert.equal(stored?.recipe?.intent, "Mira lands on a rooftop");
  assert.deepEqual(stored?.recipe?.characters, ["mira"]);
  assert.equal(stored?.recipe?.usage?.seconds_generated, 5);
  assert.equal(meter.report().total.cost_usd, 0.5);
  assert.deepEqual(progress.map((event) => event.phase), ["queued", "generating"]);
  assert.equal(progress[0]!.operation, "generate");
  assert.ok(!JSON.stringify(result.data).includes("base64"));
});

test("extend, transform, and regenerate keep parent/replay lineage", async () => {
  const { glove, assets, log } = await setup();
  const imported = await glove.run("glove_video_import", {
    data: Buffer.from(VIDEO).toString("base64"),
    mime: "video/mp4",
    duration: 5,
  });
  const base = (imported.data as any).id;
  const extended = await glove.run("glove_video_extend", {
    asset: base,
    instruction: "camera follows the runner into the tunnel",
    duration: 5,
  });
  assert.equal(extended.status, "success");
  assert.equal(log.extend.length, 1);
  const extendedAsset = await assets.get((extended.data as any).assets[0].id);
  assert.equal(extendedAsset?.recipe?.kind, "extended");
  assert.equal(extendedAsset?.recipe?.parent, base);

  const transformed = await glove.run("glove_video_transform", {
    asset: base,
    instruction: "make it look like stop motion",
    duration: 5,
  });
  assert.equal(transformed.status, "success");
  assert.equal(log.transform.length, 1);

  const generated = await glove.run("glove_video_generate", { intent: "waves break", duration: 5 });
  const regenerated = await glove.run("glove_video_regenerate", {
    asset: (generated.data as any).assets[0].id,
    tweak: "at sunrise",
  });
  assert.equal(regenerated.status, "success");
  assert.match(log.generate.at(-1)!.prompt, /at sunrise/);

  const refused = await glove.run("glove_video_regenerate", { asset: base });
  assert.equal(refused.status, "error");
  assert.match(refused.message!, /no replayable/);
});

test("saved multi-shot flow executes dependencies and extend continuity", async () => {
  const { glove, assets, log, flows } = await setup();
  const saved = await glove.run("glove_video_flow_save", {
    name: "market-arrival",
    shots: [
      { id: "wide", intent: "Wide view of the market", params: { duration: 5 } },
      {
        id: "follow",
        intent: "Follow the courier through the crowd",
        continuity: { from: "wide", mode: "extend" },
        params: { duration: 5 },
      },
    ],
  });
  assert.equal(saved.status, "success");
  const result = await glove.run("glove_video_flow_run", { name: "market-arrival" });
  assert.equal(result.status, "success");
  const run = result.data as any;
  assert.equal(run.status, "succeeded");
  assert.equal(log.generate.length, 1);
  assert.equal(log.extend.length, 1);
  const storedRun = await flows.getRun(run.id);
  const followId = storedRun!.shots.find((shot) => shot.shot === "follow")!.assets[0]!;
  const follow = await assets.get(followId);
  assert.equal(follow?.source, "flow");
  assert.deepEqual(follow?.recipe?.flow, { run: run.id, shot: "follow" });
  assert.equal(follow?.recipe?.kind, "flow-shot");
  assert.ok(follow?.recipe?.parent);
});

test("flow delivery reveals a sequence only after every selected shot passes review", async () => {
  const reviewer = queuedReviewer([
    JSON.stringify({
      decision: "pass",
      score: 91,
      summary: "The first campaign shot is coherent.",
      strengths: ["Stable subject"],
      issues: [],
    }),
    JSON.stringify({
      decision: "pass",
      score: 93,
      summary: "The second campaign shot preserves the subject.",
      strengths: ["Consistent identity"],
      issues: [],
    }),
  ], []);
  const { glove } = await setup(true, reviewer);
  await glove.run("glove_video_flow_save", {
    name: "campaign",
    shots: [
      { id: "studio", intent: "Studio portrait", params: { duration: 5 } },
      { id: "street", intent: "Street portrait", params: { duration: 5 } },
    ],
  });
  const runResult = await glove.run("glove_video_flow_run", { name: "campaign" });
  const run = runResult.data as any;
  const assets = run.shots.map((shot: any) => shot.assets[0] as string);

  const premature = await glove.run("glove_video_flow_deliver", { run: run.id });
  assert.equal(premature.status, "error");
  assert.match(premature.message!, /has not been reviewed/);

  for (const asset of assets) await glove.run("glove_video_review", { asset });
  const delivered = await glove.run("glove_video_flow_deliver", { run: run.id });
  assert.equal(delivered.status, "success");
  assert.equal((delivered.data as any).approved, true);
  assert.deepEqual((delivered.data as any).shots.map((shot: any) => shot.asset.id), assets);
  assert.equal((delivered.renderData as any).kind, "video-gallery");
});

test("invalid flow graphs and import ambiguity are tool errors", async () => {
  const { glove } = await setup();
  const invalid = await glove.run("glove_video_flow_save", {
    name: "bad-flow",
    shots: [{ id: "a", intent: "x", depends_on: ["missing"] }],
  });
  assert.equal(invalid.status, "error");
  assert.match(invalid.message!, /unknown shot/);

  const ambiguous = await glove.run("glove_video_import", {
    url: "data:video/mp4;base64,AA==",
    data: "AA==",
    duration: 1,
  });
  assert.equal(ambiguous.status, "error");
});

test("review-enabled generation keeps drafts hidden and delivery requires an actual-video pass", async () => {
  const requests: PromptRequest[] = [];
  const reviewer = queuedReviewer([
    JSON.stringify({
      decision: "pass",
      score: 92,
      summary: "The requested rooftop landing is coherent and presentation-ready.",
      strengths: ["Clear action", "Stable subject"],
      issues: [],
    }),
  ], requests);
  const { glove, reviews, usage } = await setup(true, reviewer);
  assert.ok(glove.tools.has("glove_video_review"));
  assert.ok(glove.tools.has("glove_video_deliver"));

  const generated = await glove.run("glove_video_generate", {
    intent: "A courier lands cleanly on a rooftop",
    duration: 5,
    refs: [{ asset: "image-ref", role: "identity" }],
  });
  assert.equal(generated.status, "success");
  assert.equal(generated.renderData, undefined, "draft must not render before review");
  assert.equal((generated.data as any).review_required, true);
  const asset = (generated.data as any).assets[0].id as string;

  const premature = await glove.run("glove_video_deliver", { asset });
  assert.equal(premature.status, "error");
  assert.match(premature.message!, /has not been reviewed/);

  const reviewed = await glove.run("glove_video_review", {
    asset,
    reference_assets: ["image-ref"],
  });
  assert.equal(reviewed.status, "success");
  assert.equal((reviewed.data as any).approved, true);
  assert.equal(requests.length, 1);
  const videoPart = requests[0]!.messages[0]!.content?.find((part) => part.type === "video");
  assert.ok(videoPart, "review model must receive a video content part");
  assert.equal(videoPart.source?.media_type, "video/mp4");
  assert.equal(videoPart.source?.data, Buffer.from(VIDEO).toString("base64"));
  const imagePart = requests[0]!.messages[0]!.content?.find((part) => part.type === "image");
  assert.ok(imagePart, "review model must receive visual references used by generation");
  assert.equal(imagePart.source?.media_type, "image/png");
  assert.equal((await reviews.latest(asset))?.decision, "pass");
  assert.deepEqual((await reviews.latest(asset))?.reference_assets, ["image-ref"]);
  assert.ok(usage.some((entry) => entry.source === "review"));

  const delivered = await glove.run("glove_video_deliver", { asset });
  assert.equal(delivered.status, "success");
  assert.equal((delivered.data as any).approved, true);
  assert.ok(delivered.renderData, "only an approved video should render");
});

test("review gate turns a nominal pass with blocking defects into actionable revision", async () => {
  const requests: PromptRequest[] = [];
  const reviewer = queuedReviewer([
    "```json\n" + JSON.stringify({
      decision: "pass",
      score: 84,
      summary: "Good composition, but the subject visibly duplicates.",
      strengths: ["Strong lighting"],
      issues: [{
        criterion: "subject consistency",
        severity: "major",
        evidence: "At 00:03 a second bird appears for six frames.",
        fix: "Keep exactly one bird throughout and remove the duplication artifact.",
      }],
      revision_prompt: "Preserve the composition but keep exactly one stable bird throughout.",
    }) + "\n```",
  ], requests);
  const { glove, reviews } = await setup(true, reviewer);
  const generated = await glove.run("glove_video_generate", { intent: "One bird crosses the frame", duration: 5 });
  const asset = (generated.data as any).assets[0].id as string;
  const reviewed = await glove.run("glove_video_review", { asset });
  assert.equal((reviewed.data as any).approved, false);
  assert.equal((reviewed.data as any).review.decision, "revise");
  assert.match((reviewed.data as any).review.revision_prompt, /exactly one stable bird/);
  assert.equal((await reviews.latest(asset))?.decision, "revise");
  const refused = await glove.run("glove_video_deliver", { asset });
  assert.equal(refused.status, "error");
});

test("review gate independently enforces the reviewer decision and score threshold", async () => {
  const cases = [
    {
      name: "explicit revise",
      review: {
        decision: "revise",
        score: 99,
        summary: "The reviewer requested one more iteration.",
        strengths: ["Technically clean"],
        issues: [],
        revision_prompt: "Keep the clean render but complete the requested creative change.",
      },
    },
    {
      name: "score below threshold",
      review: {
        decision: "pass",
        score: 79,
        summary: "No single blocker, but the result does not meet the quality bar.",
        strengths: ["Stable camera"],
        issues: [],
        revision_prompt: "Improve the overall finish until it clears the quality threshold.",
      },
    },
  ];

  for (const item of cases) {
    const reviewer = queuedReviewer([JSON.stringify(item.review)], []);
    const { glove, reviews } = await setup(true, reviewer);
    const generated = await glove.run("glove_video_generate", {
      intent: `Gate test: ${item.name}`,
      duration: 5,
    });
    const asset = (generated.data as any).assets[0].id as string;
    const reviewed = await glove.run("glove_video_review", { asset });

    assert.equal((reviewed.data as any).approved, false, item.name);
    assert.equal((reviewed.data as any).review.decision, "revise", item.name);
    assert.equal((await reviews.latest(asset))?.decision, "revise", item.name);
    assert.equal((await glove.run("glove_video_deliver", { asset })).status, "error", item.name);
  }
});
