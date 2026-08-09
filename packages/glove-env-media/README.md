# glove-env-media

Video and audio stdlib adapter for [`glove-working-environment`](../glove-working-environment). Bridges ffmpeg into the agent's virtual filesystem as **`env:media`** — describe a video without looking at it, thumbnail, extract frames, clip, concat, transcode, extract and burn in subtitles, measure and normalise loudness, build a slideshow. Paths in, paths out.

```bash
pnpm add glove-env-media
```

Static ffmpeg and ffprobe binaries ship as dependencies, so there is no system requirement.

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { media } from "glove-env-media";

const env = await createWorkingEnvironment({ stdlib: [media()] });
// or point at a system build:
const env2 = await createWorkingEnvironment({ stdlib: [media({ ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" })] });
```

## ffmpeg runs on the host. The sandbox still spawns nothing.

Every other adapter is a pure library call, and "no process spawning" is one of the environment's stated non-goals — so this one deserves to be explicit rather than discovered.

**The subprocess is started by this host-side adapter, never by sandboxed code.** A script calls `transcode(input, output)` with two VFS paths. It cannot name a program, pass a flag, choose a codec string, or observe that a process was involved at all. That is the same trust position as any adapter — `create(vfs)` is the capability boundary and adapters are trusted host code — but it is a bigger deal here, so it is stated plainly.

Arguments always reach ffmpeg as an argv array through `execFile`, never as a shell string. A VFS path containing a space, a quote or a semicolon is just a filename; there is no shell to inject into. A test pins that.

## What the model gets

| Function | Does |
|---|---|
| `describe(path)` | Codecs, duration, dimensions, fps, stream layout — no pixel data |
| `thumbnail(input, output, atSeconds?)` | One frame, as an image |
| `frames(input, dir, { fps?, limit? })` | Frames into a directory as PNGs; returns the paths |
| `clip(input, output, { start, end })` | Cut a range, by seconds |
| `concat(inputs, output)` | Join files end to end |
| `transcode(input, output, { crf?, scale?, fps? })` | Re-encode: container, quality, size, rate |
| `extractAudio(input, output, opts?)` | Strip the audio out, at a codec/bitrate/sample rate you choose |
| `extractSubtitles(input, output, { track? })` | A subtitle stream as a file — and a format conversion on the way |
| `burnSubtitles(input, output, { track?, subtitles? })` | Subtitles painted into the picture, from a track or a file |
| `loudness(input)` | Integrated LUFS, true peak, range — the units a platform spec is written in |
| `normalize(input, output, opts?)` | Loudness to a target, in two passes; video copied untouched |
| `waveform(input, output, opts?)` | The audio as a picture: dead air, clipping, is-anything-there |
| `slideshow(images, output, { frameMs?, size? })` | Stills → video |

```js
import { describe, frames } from 'env:media';
import { contactSheet } from 'env:images';

/** A visual overview of a video nobody can watch. */
export default async function main() {
  const info = await describe('/inbox/recording.mp4');
  const shots = await frames('/inbox/recording.mp4', '/tmp/shots', { fps: 0.1, limit: 24 });
  await contactSheet(shots, '/out/overview.png', { cell: 240, columns: 6 });
  return info;
}
```

`describe()` is the first call on any media file. A video cannot go anywhere near a context window, so the summary and a frame or two are all a model has to reason with — which is exactly why "paths in, paths out" pays most here.

## Details worth knowing

**Media work is slow**, so ffmpeg gets its own budget (two minutes per call by default, `timeoutMs`) rather than sharing the script timeout. A long transcode can still exceed it; the error says so and names the fix.

**Arguments are checked before ffmpeg starts.** An end before its start, a CRF of 99, a fractional pixel size, an empty slideshow — each fails as a sentence rather than as ffmpeg's usage output. When ffmpeg itself fails, only the last few lines of its stderr reach the model: the build banner is a hundred lines of nothing actionable.

**Staging is cleaned up on both paths.** Operations copy VFS bytes into a host temp directory, run, and read results back. The directory is removed in a `finally` — a failed transcode must not leave a gigabyte behind any more than a successful one, and there is a test that counts.

**Slideshow stills are padded, not stretched**, when `size` is given, so images of different shapes are not distorted to match each other.

**`normalize` always measures first.** loudnorm run blind is a dynamic compressor that lands somewhere near the target; the difference between "near −14 LUFS" and "−14 LUFS" is the entire reason anyone asks. So the first pass measures and the second applies that measurement as a fixed gain, and any video in the file is copied rather than re-encoded.

**Filter graphs never carry a caller's path.** A filename inside an ffmpeg filter graph is *parsed* — `:` starts the next option, `\` escapes — so there is no general safe escaping for one. `burnSubtitles` instead runs ffmpeg from inside the staging directory and names a bare file that was already reduced to `[\w.-]`, and every colour or size that reaches a graph is validated against a pattern first.

Media files are claimed by the `describe` verb, so orientation on a mounted video needs no script.
