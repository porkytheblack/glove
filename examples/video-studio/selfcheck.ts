import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { config } from "dotenv";
import type { SubscriberAdapter } from "glove-core";
import {
  InMemoryVideoAssetStore,
  InMemoryVideoFlowStore,
  InMemoryVideoLibrary,
  createVideoDraft,
  fitVideoToModel,
  openrouterVideo,
  runVideoFlow,
  runVideoPipeline,
  type VideoAsset,
} from "glove-video";
import { localFfmpegVideo } from "./local-video-adapter";
import { createVideoStudio } from "./studio";

config();
const execFileAsync = promisify(execFile);
const outputDirectory = new URL("./out/selfcheck/", import.meta.url).pathname;
await mkdir(outputDirectory, { recursive: true });

async function assertPlayable(name: string, asset: VideoAsset, bytes: Uint8Array): Promise<string> {
  const path = `${outputDirectory}${name}.mp4`;
  await writeFile(path, bytes);
  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,width,height",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const probe = JSON.parse(stdout) as {
    streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  if (probe.streams?.[0]?.codec_name !== "h264") throw new Error(`${name}: expected h264 video`);
  if (!probe.streams[0].width || !probe.streams[0].height) throw new Error(`${name}: missing dimensions`);
  if (Number(probe.format?.duration ?? 0) <= 0) throw new Error(`${name}: missing duration`);
  if (asset.mime !== "video/mp4") throw new Error(`${name}: wrong stored mime`);
  return path;
}

async function localSelfcheck(): Promise<void> {
  const adapter = localFfmpegVideo();
  const requiredModes = ["text-to-video", "image-to-video", "video-to-video", "extend"] as const;
  for (const mode of requiredModes) {
    if (!adapter.capabilities.modes.includes(mode)) throw new Error(`Missing advertised mode ${mode}`);
  }

  const pipeline = await runVideoPipeline(
    createVideoDraft({
      intent: "A paper airplane crosses a graphic test field",
      negative: "watermark",
      params: { duration: 9, aspectRatio: "4:3", resolution: "4k", audio: true },
    }),
    [fitVideoToModel()],
    {
      library: new InMemoryVideoLibrary(),
      assets: new InMemoryVideoAssetStore(),
      capabilities: adapter.capabilities,
    },
  );
  if (pipeline.params.duration !== 3 || pipeline.params.aspectRatio !== "16:9") {
    throw new Error("Capability fitting did not clamp duration/aspect ratio.");
  }
  if (!pipeline.trace[0]?.note?.includes("Audio disabled")) {
    throw new Error("Capability fitting did not advertise its audio degradation.");
  }

  const progress: string[] = [];
  const generated = await adapter.generate(
    {
      prompt: pipeline.prompt,
      refs: [],
      params: { duration: 2, aspectRatio: "16:9", resolution: "360p" },
    },
    { onProgress: (event) => { progress.push(event.phase); } },
  );
  if (progress.join(",") !== "queued,generating,downloading") {
    throw new Error(`Unexpected progress sequence: ${progress.join(",")}`);
  }
  const generatedAsset: VideoAsset = {
    id: "generated",
    mime: generated.videos[0]!.mime,
    width: generated.videos[0]!.width ?? 0,
    height: generated.videos[0]!.height ?? 0,
    duration: generated.videos[0]!.duration ?? 0,
    source: "generated",
    created_at: new Date().toISOString(),
  };
  await assertPlayable("text-to-video", generatedAsset, generated.videos[0]!.bytes);

  const imageBytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const imageVideo = await adapter.generate({
    prompt: "Slow push into the supplied frame",
    refs: [{ asset: "frame", role: "first-frame", mime: "image/png", bytes: imageBytes }],
    params: { duration: 2, aspectRatio: "9:16", resolution: "360p" },
  });
  await assertPlayable("image-to-video", generatedAsset, imageVideo.videos[0]!.bytes);

  const source = { bytes: generated.videos[0]!.bytes, mime: "video/mp4" };
  const extended = await adapter.extend!({
    prompt: "Continue the motion",
    refs: [],
    params: { duration: 2, aspectRatio: "16:9", resolution: "360p" },
    source,
  });
  await assertPlayable("extend", generatedAsset, extended.videos[0]!.bytes);

  const transformed = await adapter.transform!({
    prompt: "Shift the color treatment",
    refs: [],
    params: { duration: 2, aspectRatio: "16:9", resolution: "360p" },
    source,
  });
  await assertPlayable("video-to-video", generatedAsset, transformed.videos[0]!.bytes);

  const flowStore = new InMemoryVideoFlowStore();
  const flowAssets = new InMemoryVideoAssetStore();
  const run = await runVideoFlow(
    {
      name: "selfcheck-flow",
      shots: [
        { id: "opening", intent: "Opening" },
        { id: "continuation", intent: "Continue", continuity: { from: "opening", mode: "extend" } },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    flowStore,
    async (shot, context) => {
      const result = shot.id === "opening"
        ? generated
        : await adapter.extend!({
            prompt: shot.intent,
            refs: [],
            params: { duration: 2, aspectRatio: "16:9", resolution: "360p" },
            source: {
              bytes: await flowAssets.bytes(context.continuityAsset!),
              mime: "video/mp4",
            },
          });
      return Promise.all(
        result.videos.map((video) =>
          flowAssets.put(video.bytes, {
            mime: video.mime,
            width: video.width ?? 0,
            height: video.height ?? 0,
            duration: video.duration ?? 0,
            source: "flow",
          }),
        ),
      );
    },
  );
  if (run.status !== "succeeded" || run.shots.some((shot) => shot.status !== "succeeded")) {
    throw new Error("Checkpointed flow did not complete.");
  }
  console.log("local selfcheck: text/image generation, transform, extend, progress, fitting, and flow passed");
}

async function liveAgentSelfcheck(): Promise<void> {
  const toolCalls = new Set<string>();
  const subscriber: SubscriberAdapter = {
    async record(event, data) {
      if (event === "tool_use") toolCalls.add((data as { name: string }).name);
      if (event === "model_response" || event === "model_response_complete") {
        for (const call of (data as { tool_calls?: Array<{ tool_name: string }> }).tool_calls ?? []) {
          toolCalls.add(call.tool_name);
        }
      }
    },
  };
  const studio = await createVideoStudio({
    stream: false,
    subscribers: [subscriber],
    videoAdapter: openrouterVideo({
      model: "x-ai/grok-imagine-video",
      capabilities: {
        modes: ["text-to-video", "image-to-video"],
        maxRefs: 1,
        refRoles: ["first-frame"],
        durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
        resolutions: ["480p", "720p"],
        audio: false,
        negativePrompt: false,
        seed: false,
        maxCandidates: 1,
      },
      pollIntervalMs: 5_000,
      maxPollAttempts: 120,
      title: "glove video-studio selfcheck",
    }),
  });
  await studio.agent.processRequest(
    [
      "Perform the complete agentic keyframe-to-video integration check now.",
      "First call glove_image_generate for a simple cinematic red paper airplane over a clean pale-blue sky, no text.",
      "Inspect that keyframe, then call glove_video_generate for a 4-second 16:9 480p clip with audio false, using that img_* result as a first-frame reference.",
      "Watch the generated video with glove_video_review, revise it if required, and call glove_video_deliver only after a pass.",
      "You must complete the generate, review, and delivery loop in this turn.",
    ].join(" "),
  );
  if (!toolCalls.has("glove_image_generate")) {
    throw new Error(`Agent did not call glove_image_generate. Calls: ${[...toolCalls].join(", ")}`);
  }
  if (!toolCalls.has("glove_video_generate")) {
    throw new Error(`Agent did not call glove_video_generate. Calls: ${[...toolCalls].join(", ")}`);
  }
  if (!toolCalls.has("glove_video_review")) {
    throw new Error(`Agent did not call glove_video_review. Calls: ${[...toolCalls].join(", ")}`);
  }
  if (!toolCalls.has("glove_video_deliver")) {
    throw new Error(`Agent did not call glove_video_deliver. Calls: ${[...toolCalls].join(", ")}`);
  }
  const images = await studio.imageAssets.list({ source: "generated" });
  const videos = await studio.videoAssets.list({ source: "generated" });
  if (images.length === 0 || videos.length === 0) throw new Error("Live agent produced incomplete assets.");
  const passed = (await studio.videoReviews.list()).find((review) => review.decision === "pass");
  if (!passed) throw new Error("Live agent did not produce a video that passed actual-video review.");
  await writeFile(
    `${outputDirectory}live-agent-keyframe.${images[0]!.mime === "image/jpeg" ? "jpg" : "png"}`,
    await studio.imageAssets.bytes(images[0]!.id),
  );
  const finalVideo = await studio.videoAssets.get(passed.asset);
  if (!finalVideo) throw new Error("Passing review points to a missing video asset.");
  const path = await assertPlayable("live-agent-keyframe-video", finalVideo, await studio.videoAssets.bytes(finalVideo.id));
  console.log(`live agent selfcheck: create → inspect → review → deliver passed (${path})`);
}

await localSelfcheck();
if (process.argv.includes("--live")) await liveAgentSelfcheck();
