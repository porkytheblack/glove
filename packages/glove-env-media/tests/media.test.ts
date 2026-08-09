/**
 * The media adapter, driven the way a script reaches it.
 *
 * Fixtures are generated rather than committed — ffmpeg's own test sources
 * (`testsrc`, `sine`) produce a real MP4 with real streams, so nothing here
 * is testing against a file someone once made and nobody can regenerate.
 * Results are read back through `ffprobe` rather than through the adapter's
 * own `describe`, so a bug in the summary cannot make a broken transform
 * look correct.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAdapterTestEnv, assertAdapterOk } from "glove-working-environment/testing";
import { media, type MediaSummary } from "../src/index";

const exec = promisify(execFile);

/** The same binaries the adapter uses, resolved independently for verification. */
async function binaries(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const [ff, fp] = await Promise.all([import("@ffmpeg-installer/ffmpeg"), import("@ffprobe-installer/ffprobe")]);
  return { ffmpeg: (ff.default ?? ff).path as string, ffprobe: (fp.default ?? fp).path as string };
}

/** A real MP4: colour bars plus a tone, `seconds` long, at `size`. */
async function makeVideo(seconds = 2, size = "320x240"): Promise<Uint8Array> {
  const { ffmpeg } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-fixture-"));
  try {
    const out = join(dir, "src.mp4");
    await exec(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=${size}:rate=10`,
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      out,
    ]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** An MKV carrying a soft subtitle track, so extraction has something to find. */
async function makeSubtitled(seconds = 4): Promise<Uint8Array> {
  const { ffmpeg } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-subs-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    const srt = join(dir, "s.srt");
    await writeFile(
      srt,
      "1\n00:00:00,500 --> 00:00:02,000\nHello from a subtitle\n\n2\n00:00:02,500 --> 00:00:03,500\nSecond line here\n",
    );
    const av = join(dir, "av.mp4");
    await exec(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=320x240:rate=10`,
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", av,
    ]);
    const out = join(dir, "subbed.mkv");
    await exec(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", av, "-i", srt, "-c", "copy", "-c:s", "srt",
      "-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=English",
      out,
    ]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A quiet tone: something with a loudness that is clearly wrong to start with. */
async function makeQuietAudio(seconds = 5, dB = -30): Promise<Uint8Array> {
  const { ffmpeg } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-tone-"));
  try {
    const out = join(dir, "tone.wav");
    await exec(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`,
      "-af", `volume=${dB}dB`, out,
    ]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Integrated loudness of some bytes, measured by ffmpeg directly. */
async function measureLufs(bytes: Uint8Array, ext = "wav"): Promise<number> {
  const { ffmpeg } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-lufs-"));
  try {
    const path = join(dir, `probe.${ext}`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, bytes);
    const { stderr } = await exec(ffmpeg, [
      "-hide_banner", "-loglevel", "info", "-nostats", "-y",
      "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ]);
    const open = stderr.lastIndexOf("{");
    return Number(JSON.parse(stderr.slice(open, stderr.indexOf("}", open) + 1)).input_i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A single PNG still, `size`, in a named colour. */
async function makeStill(colour: string, size = "160x120"): Promise<Uint8Array> {
  const { ffmpeg } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-still-"));
  try {
    const out = join(dir, "still.png");
    await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${size}`, "-frames:v", "1", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Probe VFS bytes with ffprobe directly — independent of the adapter. */
async function probe(bytes: Uint8Array, ext = "mp4"): Promise<Record<string, any>> {
  const { ffprobe } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-probe-"));
  try {
    const path = join(dir, `probe.${ext}`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, bytes);
    const { stdout } = await exec(ffprobe, ["-hide_banner", "-loglevel", "error", "-print_format", "json", "-show_format", "-show_streams", path]);
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const env = () => createAdapterTestEnv(media());

test("the adapter's bindings and types agree", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

test("describe reports streams and duration without returning pixels", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(2, "320x240"));

  const info = await t.script<MediaSummary>(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/clip.mp4'); }`,
  );
  assert.match(info.format, /mp4/);
  assert.ok(info.duration !== null && info.duration > 1.5 && info.duration < 3, `duration was ${info.duration}`);
  assert.equal(info.width, 320);
  assert.equal(info.height, 240);
  assert.ok(info.fps && info.fps > 0);

  const kinds = info.streams.map((s) => s.kind).sort();
  assert.deepEqual(kinds, ["audio", "video"]);
  const video = info.streams.find((s) => s.kind === "video")!;
  const audio = info.streams.find((s) => s.kind === "audio")!;
  assert.equal(video.codec, "h264");
  assert.ok(audio.sampleRate && audio.sampleRate > 0);

  // The summary must stay small — that is the entire point of describe().
  assert.ok(JSON.stringify(info).length < 2000, "a summary a model reads must not be large");
});

test("thumbnail produces a real image at the requested second", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(3));

  const out = await t.script<string>(
    `import { thumbnail } from 'env:media';
     export default async function main() { return thumbnail('/inbox/clip.mp4', '/out/cover.png', 2); }`,
  );
  assert.equal(out, "/out/cover.png");
  const bytes = await t.fs.readBytes("/out/cover.png");
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "should be a PNG");

  const probed = await probe(bytes, "png");
  assert.equal(probed.streams[0].width, 320);
  assert.equal(probed.streams[0].height, 240);
});

test("frames writes one file per sampled frame, capped by limit", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(4));

  const paths = await t.script<string[]>(
    `import { frames } from 'env:media';
     export default async function main() { return frames('/inbox/clip.mp4', '/tmp/shots', { fps: 2, limit: 5 }); }`,
  );
  assert.equal(paths.length, 5, "limit must cap the count");
  assert.ok(paths.every((p) => p.startsWith("/tmp/shots/")), paths.join(", "));
  for (const p of paths) {
    const bytes = await t.fs.readBytes(p);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${p} should be a PNG`);
  }
});

test("clip cuts the requested range", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/long.mp4", await makeVideo(6));

  await t.script(
    `import { clip } from 'env:media';
     export default async function main() { return clip('/inbox/long.mp4', '/out/cut.mp4', { start: 1, end: 3 }); }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/cut.mp4"));
  const duration = Number(probed.format.duration);
  assert.ok(duration > 1.5 && duration < 2.6, `expected roughly 2 seconds, got ${duration}`);
});

test("concat joins clips end to end", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/src.mp4", await makeVideo(4));

  await t.script(
    `import { clip, concat } from 'env:media';
     export default async function main() {
       await clip('/inbox/src.mp4', '/tmp/a.mp4', { start: 0, end: 1 });
       await clip('/inbox/src.mp4', '/tmp/b.mp4', { start: 1, end: 2 });
       return concat(['/tmp/a.mp4', '/tmp/b.mp4'], '/out/joined.mp4');
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/joined.mp4"));
  const duration = Number(probed.format.duration);
  assert.ok(duration > 1.5, `two one-second clips should join to about two seconds, got ${duration}`);
});

test("transcode rescales and re-encodes", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/big.mp4", await makeVideo(2, "640x480"));

  await t.script(
    `import { transcode } from 'env:media';
     export default async function main() {
       return transcode('/inbox/big.mp4', '/out/small.mp4', { scale: [320, 240], crf: 30 });
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/small.mp4"));
  const video = probed.streams.find((s: any) => s.codec_type === "video");
  assert.equal(video.width, 320);
  assert.equal(video.height, 240);
});

test("extractAudio drops the video stream", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/av.mp4", await makeVideo(2));

  await t.script(
    `import { extractAudio } from 'env:media';
     export default async function main() { return extractAudio('/inbox/av.mp4', '/out/track.m4a'); }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/track.m4a"), "m4a");
  const kinds = probed.streams.map((s: any) => s.codec_type);
  assert.deepEqual(kinds, ["audio"], "the video stream must be gone");
});

test("extractAudio honours the codec, bitrate, sample rate and channel count asked for", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/av.mp4", await makeVideo(3));

  await t.script(
    `import { extractAudio } from 'env:media';
     export default async function main() {
       return extractAudio('/inbox/av.mp4', '/out/track.mp3',
                           { codec: 'mp3', bitrate: 192, sampleRate: 44100, channels: 2 });
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/track.mp3"), "mp3");
  const audio = probed.streams.find((s: any) => s.codec_type === "audio");
  assert.equal(audio.codec_name, "mp3", "the requested encoder, not the container's default");
  assert.equal(Number(audio.sample_rate), 44100);
  assert.equal(Number(audio.channels), 2);
  assert.ok(Number(audio.bit_rate) > 180_000, `asked for 192k, got ${audio.bit_rate}`);
});

test("codec: copy moves the encoded stream across untouched", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/av.mp4", await makeVideo(2));
  const source = (await probe(await t.fs.readBytes("/inbox/av.mp4"))).streams.find((s: any) => s.codec_type === "audio");

  await t.script(
    `import { extractAudio } from 'env:media';
     export default async function main() { return extractAudio('/inbox/av.mp4', '/out/copy.m4a', { codec: 'copy' }); }`,
  );
  const copied = (await probe(await t.fs.readBytes("/out/copy.m4a"), "m4a")).streams[0];
  assert.equal(copied.codec_name, source.codec_name, "still AAC — nothing was decoded");
  assert.equal(copied.sample_rate, source.sample_rate);
});

test("a codec that cannot take a bitrate says so instead of ignoring it", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/av.mp4", await makeVideo(1));
  const run = await t.runScript(
    `import { extractAudio } from 'env:media';
     export default async function main() {
       return extractAudio('/inbox/av.mp4', '/out/x.m4a', { codec: 'copy', bitrate: 192 });
     }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /re-muxes the existing stream untouched, so bitrate cannot apply/);
});

// ============================================================== subtitles

test("subtitle streams are reported with a track number and a language", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/film.mkv", await makeSubtitled());

  const info = await t.script<MediaSummary>(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/film.mkv'); }`,
  );
  const subs = info.streams.filter((s) => s.kind === "subtitle");
  assert.equal(subs.length, 1);
  assert.equal(subs[0].track, 0, "counted among subtitles, not among all streams");
  assert.equal(subs[0].language, "eng");
  assert.equal(info.streams.find((s) => s.kind === "audio")?.track, 0, "each kind counts from zero");
});

test("extractSubtitles writes the track out, and converts it on the way", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/film.mkv", await makeSubtitled());

  const out = await t.script<string[]>(
    `import { extractSubtitles } from 'env:media';
     export default async function main() {
       return [
         await extractSubtitles('/inbox/film.mkv', '/out/film.srt'),
         await extractSubtitles('/inbox/film.mkv', '/out/film.vtt', { track: 0 }),
       ];
     }`,
  );
  assert.deepEqual(out, ["/out/film.srt", "/out/film.vtt"]);

  const srt = new TextDecoder().decode(await t.fs.readBytes("/out/film.srt"));
  assert.match(srt, /Hello from a subtitle/);
  assert.match(srt, /Second line here/);
  assert.match(srt, /-->/, "SubRip cues, not a transcript");

  const vtt = new TextDecoder().decode(await t.fs.readBytes("/out/film.vtt"));
  assert.match(vtt, /^WEBVTT/, "the extension picked the format");
  assert.match(vtt, /Hello from a subtitle/);
});

test("burnSubtitles paints an embedded track into the picture", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/film.mkv", await makeSubtitled());

  await t.script(
    `import { burnSubtitles } from 'env:media';
     export default async function main() { return burnSubtitles('/inbox/film.mkv', '/out/hard.mp4', { track: 0 }); }`,
  );
  const bytes = await t.fs.readBytes("/out/hard.mp4");
  const probed = await probe(bytes);
  const kinds = probed.streams.map((s: any) => s.codec_type).sort();
  assert.deepEqual(kinds, ["audio", "video"], "the subtitle stream is gone — it is pixels now");

  // The picture actually changed: compare a frame against the same frame of a
  // plain transcode, so this cannot pass on "ffmpeg produced a file".
  const { ffmpeg } = await binaries();
  const dir = await mkdtemp(join(tmpdir(), "glove-media-burn-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "hard.mp4"), bytes);
    await writeFile(join(dir, "src.mkv"), await t.fs.readBytes("/inbox/film.mkv"));
    for (const [file, out] of [["hard.mp4", "hard.png"], ["src.mkv", "plain.png"]]) {
      await exec(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", join(dir, file), "-frames:v", "1", join(dir, out)]);
    }
    const [hard, plain] = await Promise.all([readFile(join(dir, "hard.png")), readFile(join(dir, "plain.png"))]);
    assert.notDeepEqual(new Uint8Array(hard), new Uint8Array(plain), "a burned-in caption has to be visible in the frame");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("burnSubtitles takes a subtitle file from the tree", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(3));
  await t.fs.writeFile("/inbox/captions.srt", "1\n00:00:00,200 --> 00:00:02,500\nCaptioned here\n");

  await t.script(
    `import { burnSubtitles } from 'env:media';
     export default async function main() {
       return burnSubtitles('/inbox/clip.mp4', '/out/captioned.mp4', { subtitles: '/inbox/captions.srt' });
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/captioned.mp4"));
  assert.ok(probed.streams.some((s: any) => s.codec_type === "video"));
  assert.ok(Number(probed.format.duration) > 2);
});

test("asking for a subtitle track that is not there names the file, not the stream map", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/plain.mp4", await makeVideo(1));
  for (const call of [
    `extractSubtitles('/inbox/plain.mp4', '/out/x.srt')`,
    `burnSubtitles('/inbox/plain.mp4', '/out/x.mp4', { track: 2 })`,
  ]) {
    const run = await t.runScript(
      `import { extractSubtitles, burnSubtitles } from 'env:media';
       export default async function main() { return ${call}; }`,
    );
    assert.equal(run.ok, false, call);
    assert.match(String(run.error), /has no subtitle track \d/, call);
    assert.match(String(run.error), /describe\(path\)/, "and points at the way to find out");
  }
});

test("an output with no subtitle extension is refused before ffmpeg runs", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/film.mkv", await makeSubtitled());
  const run = await t.runScript(
    `import { extractSubtitles } from 'env:media';
     export default async function main() { return extractSubtitles('/inbox/film.mkv', '/out/subs.txt'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /cannot tell what subtitle format to write/);
  assert.match(String(run.error), /\.srt, \.vtt, \.ass/);
});

// =============================================================== loudness

test("loudness reports a reading a platform spec is written in", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/quiet.wav", await makeQuietAudio(5, -30));

  const out = await t.script<{ path: string; lufs: number; truePeak: number; range: number; threshold: number }>(
    `import { loudness } from 'env:media';
     export default async function main() { return loudness('/inbox/quiet.wav'); }`,
  );
  assert.equal(out.path, "/inbox/quiet.wav");
  assert.ok(out.lufs < -30 && out.lufs > -60, `a -30 dB tone should read well below -14 LUFS, got ${out.lufs}`);
  assert.ok(out.truePeak < 0, `true peak ${out.truePeak} should be under the ceiling`);
  assert.ok(Number.isFinite(out.range) && Number.isFinite(out.threshold));
});

test("normalize lands on the target, not near it", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/quiet.wav", await makeQuietAudio(6, -30));
  const before = await measureLufs(await t.fs.readBytes("/inbox/quiet.wav"));
  assert.ok(before < -30, `fixture should start quiet, measured ${before}`);

  await t.script(
    `import { normalize } from 'env:media';
     export default async function main() { return normalize('/inbox/quiet.wav', '/out/loud.wav', { lufs: -14 }); }`,
  );
  const after = await measureLufs(await t.fs.readBytes("/out/loud.wav"));
  assert.ok(Math.abs(after + 14) < 1, `expected about -14 LUFS, measured ${after} (was ${before})`);
});

test("normalize re-encodes to the audio format asked for and leaves video alone", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/av.mp4", await makeVideo(3));
  const source = (await probe(await t.fs.readBytes("/inbox/av.mp4"))).streams.find((s: any) => s.codec_type === "video");

  await t.script(
    `import { normalize } from 'env:media';
     export default async function main() {
       return normalize('/inbox/av.mp4', '/out/level.mp4', { lufs: -16, codec: 'aac', bitrate: 128 });
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/level.mp4"));
  const video = probed.streams.find((s: any) => s.codec_type === "video");
  const audio = probed.streams.find((s: any) => s.codec_type === "audio");
  assert.equal(video.codec_name, source.codec_name, "the video stream was copied, not re-encoded");
  assert.equal(video.width, source.width);
  assert.equal(audio.codec_name, "aac");
});

test("loudness refuses what it cannot measure, in those terms", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/silent.mp4", await makeStill("black"));
  const run = await t.runScript(
    `import { loudness } from 'env:media';
     export default async function main() { return loudness('/inbox/silent.mp4'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /has no audio to measure/);
});

test("waveform draws the audio as a picture", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/tone.wav", await makeQuietAudio(4, -10));

  const out = await t.script<string>(
    `import { waveform } from 'env:media';
     export default async function main() {
       return waveform('/inbox/tone.wav', '/out/wave.png', { size: [400, 100], colour: '#ff0000' });
     }`,
  );
  assert.equal(out, "/out/wave.png");
  const bytes = await t.fs.readBytes("/out/wave.png");
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "should be a PNG");
  const probed = await probe(bytes, "png");
  assert.equal(probed.streams[0].width, 400);
  assert.equal(probed.streams[0].height, 100);
});

test("waveform checks its own arguments rather than pasting them into a filter", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/tone.wav", await makeQuietAudio(1, -10));
  for (const [call, pattern] of [
    [`waveform('/inbox/tone.wav', '/out/x.png', { colour: 'red:drawbox=1' })`, /colour must be #rrggbb/],
    [`waveform('/inbox/tone.wav', '/out/x.png', { size: [0, 100] })`, /whole pixels/],
    [`normalize('/inbox/tone.wav', '/out/x.wav', { lufs: 5 })`, /lufs must be an integrated target in LUFS between -70 and -5/],
    [`normalize('/inbox/tone.wav', '/out/x.wav', { codec: 'copy' })`, /re-encodes the audio by definition/],
  ] as const) {
    const run = await t.runScript(
      `import { waveform, normalize } from 'env:media';
       export default async function main() { return ${call}; }`,
    );
    assert.equal(run.ok, false, call);
    assert.match(String(run.error), pattern, call);
  }
});

test("slideshow turns stills into a real video", async () => {
  const t = await env();
  for (const [i, colour] of ["red", "green", "blue", "white"].entries()) {
    await t.fs.writeFile(`/inbox/frames/still-${i}.png`, await makeStill(colour));
  }

  await t.script(
    `import { glob } from 'env:fs';
     import { slideshow } from 'env:media';
     export default async function main() {
       const stills = (await glob('/inbox/frames/*.png')).sort();
       return slideshow(stills, '/out/show.mp4', { frameMs: 500, size: [320, 240] });
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/show.mp4"));
  const video = probed.streams.find((s: any) => s.codec_type === "video");
  assert.equal(video.width, 320);
  assert.equal(video.height, 240);
  assert.ok(Number(probed.format.duration) > 1, "four stills at 500ms should run about two seconds");
});

test("stills of mixed sizes are padded, not distorted", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/f/a.png", await makeStill("red", "160x120"));
  await t.fs.writeFile("/inbox/f/b.png", await makeStill("blue", "120x160"));

  await t.script(
    `import { glob } from 'env:fs';
     import { slideshow } from 'env:media';
     export default async function main() {
       return slideshow((await glob('/inbox/f/*.png')).sort(), '/out/mixed.mp4', { size: [320, 320] });
     }`,
  );
  const probed = await probe(await t.fs.readBytes("/out/mixed.mp4"));
  const video = probed.streams.find((s: any) => s.codec_type === "video");
  assert.equal(video.width, 320);
  assert.equal(video.height, 320);
});

// ============================================ arguments checked before ffmpeg

test("bad arguments fail as sentences, before ffmpeg is ever started", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(2));

  const cases: Array<[string, string, RegExp]> = [
    ["end before start", `clip('/inbox/clip.mp4', '/out/x.mp4', { start: 5, end: 2 })`, /end \(2s\) must be after start \(5s\)/],
    ["negative start", `clip('/inbox/clip.mp4', '/out/x.mp4', { start: -1, end: 2 })`, /start must be a non-negative number/],
    ["crf out of range", `transcode('/inbox/clip.mp4', '/out/x.mp4', { crf: 99 })`, /crf must be a whole number from 0/],
    ["fractional scale", `transcode('/inbox/clip.mp4', '/out/x.mp4', { scale: [10.5, 20] })`, /whole pixels/],
    ["zero fps", `frames('/inbox/clip.mp4', '/tmp/f', { fps: 0 })`, /fps must be a positive number/],
    ["one input to concat", `concat(['/inbox/clip.mp4'], '/out/x.mp4')`, /at least two input paths/],
    ["empty slideshow", `slideshow([], '/out/x.mp4')`, /at least one image path/],
  ];
  for (const [label, call, pattern] of cases) {
    const run = await t.runScript(
      `import { clip, transcode, frames, concat, slideshow } from 'env:media';
       export default async function main() { return ${call}; }`,
    );
    assert.equal(run.ok, false, `${label}: expected a refusal`);
    assert.match(String(run.error), pattern, label);
  }
});

test("a file that is not media fails with ffmpeg's own reason, trimmed", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/notmedia.mp4", new TextEncoder().encode("this is plain text, not a video"));
  const run = await t.runScript(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/notmedia.mp4'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /env:media\.describe:/, "the capability should be named");
  assert.ok(String(run.error).length < 600, "ffmpeg's build banner must not reach the model");
});

test("an empty input is refused before staging", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/empty.mp4", new Uint8Array(0));
  const run = await t.runScript(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/empty.mp4'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(String(run.error), /is empty — there is nothing to read/);
});

test("paths with shell metacharacters are filenames, not commands", async () => {
  // execFile with an argv array means there is no shell to inject into. This
  // pins that: a path that would be catastrophic through a shell string is
  // simply a name here.
  const t = await env();
  await t.fs.writeFile("/inbox/a b; echo pwned .mp4", await makeVideo(1));
  const info = await t.script<MediaSummary>(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/a b; echo pwned .mp4'); }`,
  );
  assert.match(info.format, /mp4/);
  assert.equal(info.path, "/inbox/a b; echo pwned .mp4");
});

test("the workspace is cleaned up on both the success and failure paths", async () => {
  const { readdir } = await import("node:fs/promises");
  const before = (await readdir(tmpdir())).filter((n) => n.startsWith("glove-media-")).length;

  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(1));
  await t.script(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/clip.mp4'); }`,
  );
  await t.runScript(
    `import { describe } from 'env:media';
     export default async function main() { return describe('/inbox/missing.mp4'); }`,
  );

  const after = (await readdir(tmpdir())).filter((n) => n.startsWith("glove-media-")).length;
  assert.equal(after, before, "a failed run must not leave its staging directory behind");
});

test("media files are claimed by the describe verb", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/clip.mp4", await makeVideo(1));
  const tool = t.env.tools.find((x) => x.name === "describe")!;
  const summary = JSON.parse(String((await tool.do({ path: "/inbox/clip.mp4" })).data));
  assert.equal(summary.module, "env:media");
  assert.match(summary.format, /mp4/);
});
