import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { localFfmpegVideo } from "../local-video-adapter";
import { withVideoOperationLimit } from "../studio";

const execFileAsync = promisify(execFile);

async function probe(bytes: Uint8Array): Promise<{ codec: string; duration: number }> {
  const directory = await mkdtemp(join(tmpdir(), "glove-video-probe-"));
  const path = join(directory, "clip.mp4");
  try {
    await writeFile(path, bytes);
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      path,
    ]);
    const data = JSON.parse(stdout) as {
      streams?: Array<{ codec_name?: string }>;
      format?: { duration?: string };
    };
    return {
      codec: data.streams?.[0]?.codec_name ?? "",
      duration: Number(data.format?.duration ?? 0),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("every advertised local adapter mode produces a playable h264 MP4", async () => {
  const adapter = localFfmpegVideo();
  assert.deepEqual(adapter.capabilities.modes, [
    "text-to-video",
    "image-to-video",
    "video-to-video",
    "extend",
  ]);
  const request = {
    prompt: "moving test pattern",
    refs: [],
    params: { duration: 2, aspectRatio: "16:9", resolution: "360p" },
  };
  const generated = await adapter.generate(request);
  const source = { bytes: generated.videos[0]!.bytes, mime: "video/mp4" };
  const extended = await adapter.extend!({ ...request, source });
  const transformed = await adapter.transform!({ ...request, source });
  for (const result of [generated, extended, transformed]) {
    assert.equal(result.videos[0]!.mime, "video/mp4");
    const media = await probe(result.videos[0]!.bytes);
    assert.equal(media.codec, "h264");
    assert.ok(media.duration >= 1.9);
  }
});

test("image-to-video accepts a first-frame image and emits ordered progress", async () => {
  const adapter = localFfmpegVideo();
  const phases: string[] = [];
  const png = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const result = await adapter.generate(
    {
      prompt: "push in",
      refs: [{ asset: "frame", role: "first-frame", bytes: png, mime: "image/png" }],
      params: { duration: 2, aspectRatio: "9:16", resolution: "360p" },
    },
    { onProgress: (event) => { phases.push(event.phase); } },
  );
  assert.deepEqual(phases, ["queued", "generating", "downloading"]);
  assert.equal(result.videos[0]!.width, 360);
  assert.equal(result.videos[0]!.height, 640);
  assert.equal((await probe(result.videos[0]!.bytes)).codec, "h264");
});

test("video operation limit is enforced before an over-budget provider call", async () => {
  const base = localFfmpegVideo();
  const limited = withVideoOperationLimit(base, 1);
  const request = {
    prompt: "budget test",
    refs: [],
    params: { duration: 2, aspectRatio: "16:9", resolution: "360p" },
  };
  await limited.adapter.generate(request);
  assert.equal(limited.used(), 1);
  await assert.rejects(limited.adapter.generate(request), /budget exhausted \(1\/1\)/);
  assert.equal(limited.used(), 1);
});
