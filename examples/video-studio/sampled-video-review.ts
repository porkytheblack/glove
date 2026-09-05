import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ContentPart, Message, ModelAdapter, PromptRequest } from "glove-core";

const execFileAsync = promisify(execFile);

function aborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Video review was aborted.", "AbortError");
}

async function sampleVideo(part: ContentPart, signal?: AbortSignal): Promise<ContentPart[]> {
  const source = part.source;
  if (!source || source.type !== "base64" || !source.data) {
    throw new Error("Sampled video review requires an inline base64 video source.");
  }

  aborted(signal);
  const directory = await mkdtemp(join(tmpdir(), "glove-video-review-"));
  try {
    const input = join(directory, "input.mp4");
    const framesPattern = join(directory, "frame-%02d.jpg");
    const waveform = join(directory, "waveform.png");
    await writeFile(input, Buffer.from(source.data, "base64"));
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-v", "error", "-i", input,
      "-vf", "fps=2,scale=640:-2",
      "-q:v", "3",
      framesPattern,
    ]);
    aborted(signal);

    const frameFiles = (await readdir(directory))
      .filter((file) => /^frame-\d+\.jpg$/.test(file))
      .sort();
    if (frameFiles.length === 0) throw new Error("ffmpeg extracted no review frames.");

    const content: ContentPart[] = [{
      type: "text",
      text: [
        `The next ${frameFiles.length} images are chronological frames sampled every 0.5 seconds from the actual video, beginning at 0.0s.`,
        "Judge temporal continuity by comparing adjacent frames: subject shape, position, lighting, camera, motion progression, flicker, morphing, and the promised ending.",
        "If an audio waveform follows, its horizontal axis spans the full clip. Compare audible onsets with the visible action timestamps; do not claim semantic audio details that a waveform cannot prove.",
      ].join(" "),
    }];
    for (const file of frameFiles) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: (await readFile(join(directory, file))).toString("base64"),
        },
      });
    }

    try {
      await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
        "-v", "error", "-i", input,
        "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1280x240:colors=0x9ED4B8",
        "-frames:v", "1",
        waveform,
      ]);
      content.push({
        type: "text",
        text: "Audio amplitude waveform for the same clip:",
      });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: (await readFile(waveform)).toString("base64"),
        },
      });
    } catch {
      content.push({ type: "text", text: "No readable audio waveform was available." });
    }
    return content;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Converts inline video parts into ordered full-clip frame samples plus an
 * audio waveform before delegating to an image-capable vision model. This is
 * useful when a provider's native video-understanding endpoint is unavailable.
 */
export function sampledVideoReviewModel(base: ModelAdapter): ModelAdapter {
  return {
    name: `sampled-video:${base.name}`,
    setSystemPrompt(systemPrompt) {
      base.setSystemPrompt(systemPrompt);
    },
    async prompt(request, notify, signal) {
      const messages: Message[] = [];
      for (const message of request.messages) {
        const content: ContentPart[] = [];
        for (const part of message.content ?? []) {
          if (part.type === "video") content.push(...await sampleVideo(part, signal));
          else content.push(part);
        }
        messages.push({ ...message, ...(message.content ? { content } : {}) });
      }
      const sampledRequest: PromptRequest = { ...request, messages };
      return base.prompt(sampledRequest, notify, signal);
    },
  };
}
