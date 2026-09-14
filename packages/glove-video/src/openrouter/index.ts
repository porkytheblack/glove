import {
  type ResolvedVideoReference,
  type VideoCallContext,
  type VideoGenerateRequest,
  type VideoModelAdapter,
  type VideoModelCapabilities,
  type VideoModelOutput,
  type VideoModelResult,
  VideoError,
  inspectMp4Metadata,
  videoToDataUrl,
} from "../core/index";

const DEFAULT_MODEL = "google/veo-3.1-lite";

const DEFAULT_CAPABILITIES: VideoModelCapabilities = {
  modes: ["text-to-video", "image-to-video"],
  maxRefs: 2,
  refRoles: ["first-frame", "last-frame"],
  durations: [4, 6, 8],
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p"],
  audio: true,
  negativePrompt: false,
  seed: false,
  maxCandidates: 1,
};

export interface OpenRouterVideoOptions {
  /** Defaults to process.env.OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Defaults to google/veo-3.1-lite. */
  model?: string;
  /** Required for non-default models; copy the values from GET /videos/models. */
  capabilities?: VideoModelCapabilities;
  /** Defaults to https://openrouter.ai/api/v1. */
  baseUrl?: string;
  /** Defaults to 30 seconds, as recommended by OpenRouter. */
  pollIntervalMs?: number;
  /** Defaults to 60 attempts. */
  maxPollAttempts?: number;
  /** Optional attribution headers. */
  referer?: string;
  title?: string;
  /** Fetch injection for non-network tests and custom runtimes. */
  fetch?: typeof globalThis.fetch;
}

interface OpenRouterVideoJob {
  id?: string;
  polling_url?: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  error?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number };
}

interface OpenRouterMediaReference {
  type: "image_url" | "video_url";
  image_url?: { url: string };
  video_url?: { url: string };
}

interface OpenRouterFrameImage extends OpenRouterMediaReference {
  frame_type: "first_frame" | "last_frame";
}

function mediaReference(ref: ResolvedVideoReference): OpenRouterMediaReference {
  const url = videoToDataUrl(ref.bytes, ref.mime);
  if (ref.mime.startsWith("image/")) {
    return { type: "image_url", image_url: { url } };
  }
  if (ref.mime.startsWith("video/")) {
    return { type: "video_url", video_url: { url } };
  }
  throw new VideoError(`OpenRouter video references must be image or video media, received ${ref.mime}.`);
}

function splitReferences(refs: ResolvedVideoReference[]): {
  frame_images?: OpenRouterFrameImage[];
  input_references?: OpenRouterMediaReference[];
} {
  const frame_images: OpenRouterFrameImage[] = [];
  const input_references: OpenRouterMediaReference[] = [];
  for (const ref of refs) {
    if (ref.role === "first-frame" || ref.role === "last-frame") {
      if (!ref.mime.startsWith("image/")) {
        throw new VideoError(`OpenRouter ${ref.role} references must be images.`);
      }
      frame_images.push({
        ...mediaReference(ref),
        frame_type: ref.role === "first-frame" ? "first_frame" : "last_frame",
      });
    } else {
      input_references.push(mediaReference(ref));
    }
  }
  return {
    ...(frame_images.length ? { frame_images } : {}),
    ...(input_references.length ? { input_references } : {}),
  };
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The video generation was aborted.", "AbortError");
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function responseError(response: Response): Promise<VideoError> {
  const detail = (await response.text()).slice(0, 500);
  return new VideoError(
    `OpenRouter ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

/**
 * OpenRouter's asynchronous video-generation API as a glove-video adapter.
 * The adapter resolves only after polling and downloading completed media.
 */
export function openrouterVideo(options: OpenRouterVideoOptions = {}): VideoModelAdapter {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const model = options.model ?? DEFAULT_MODEL;
  if (model !== DEFAULT_MODEL && !options.capabilities) {
    throw new VideoError(
      `Pass capabilities for OpenRouter model "${model}" using GET /api/v1/videos/models.`,
    );
  }
  const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
  const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const baseOrigin = new URL(baseUrl).origin;
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const maxPollAttempts = options.maxPollAttempts ?? 60;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  function headers(url: string, json = false): Record<string, string> {
    const targetOrigin = new URL(url, `${baseUrl}/`).origin;
    const isOpenRouter = targetOrigin === baseOrigin;
    return {
      ...(isOpenRouter && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(isOpenRouter && options.referer ? { "HTTP-Referer": options.referer } : {}),
      ...(isOpenRouter && options.title ? { "X-Title": options.title } : {}),
    };
  }

  async function fetchJob(url: string, init: RequestInit): Promise<OpenRouterVideoJob> {
    const response = await fetchImpl(url, init);
    if (!response.ok) throw await responseError(response);
    return (await response.json()) as OpenRouterVideoJob;
  }

  async function submit(request: VideoGenerateRequest, ctx?: VideoCallContext): Promise<{
    job: OpenRouterVideoJob;
    output: VideoModelOutput;
  }> {
    if (!apiKey) {
      throw new VideoError(
        "OpenRouter API key missing — pass apiKey or set OPENROUTER_API_KEY.",
      );
    }
    const extra = request.params.extra ?? {};
    const endpoint = `${baseUrl}/videos`;
    let job = await fetchJob(endpoint, {
      method: "POST",
      signal: ctx?.signal,
      headers: headers(endpoint, true),
      body: JSON.stringify({
        ...extra,
        model,
        prompt: request.prompt,
        ...(request.params.duration !== undefined ? { duration: request.params.duration } : {}),
        ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
        ...(request.params.aspectRatio ? { aspect_ratio: request.params.aspectRatio } : {}),
        ...(request.params.audio !== undefined ? { generate_audio: request.params.audio } : {}),
        ...(request.params.seed !== undefined ? { seed: request.params.seed } : {}),
        ...splitReferences(request.refs),
      }),
    });
    if (!job.id) throw new VideoError("OpenRouter video submission did not return a job id.");
    await ctx?.onProgress?.({
      phase: "queued",
      progress: 0,
      provider_job_id: job.id,
    });

    for (let attempt = 0; attempt < maxPollAttempts && job.status !== "completed"; attempt += 1) {
      if (["failed", "cancelled", "expired"].includes(job.status ?? "")) {
        throw new VideoError(job.error ?? `OpenRouter video generation ${job.status}.`);
      }
      await ctx?.onProgress?.({
        phase: job.status === "in_progress" ? "generating" : "queued",
        progress: Math.min(0.9, (attempt + 1) / Math.max(maxPollAttempts, 1)),
        provider_job_id: job.id,
      });
      await wait(pollIntervalMs, ctx?.signal);
      const pollingUrl = new URL(
        job.polling_url ?? `${baseUrl}/videos/${job.id}`,
        `${baseUrl}/`,
      ).href;
      job = await fetchJob(pollingUrl, {
        signal: ctx?.signal,
        headers: headers(pollingUrl),
      });
    }

    if (job.status !== "completed") {
      throw new VideoError(
        `OpenRouter video generation did not complete after ${maxPollAttempts} poll attempts.`,
      );
    }
    const contentUrl = new URL(
      job.unsigned_urls?.[0] ?? `${baseUrl}/videos/${job.id}/content?index=0`,
      `${baseUrl}/`,
    ).href;
    await ctx?.onProgress?.({
      phase: "downloading",
      progress: 0.95,
      provider_job_id: job.id,
    });
    const response = await fetchImpl(contentUrl, {
      signal: ctx?.signal,
      headers: headers(contentUrl),
    });
    if (!response.ok) throw await responseError(response);
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "video/mp4";
    const bytes = new Uint8Array(await response.arrayBuffer());
    const metadata = mime === "video/mp4" ? inspectMp4Metadata(bytes) : {};
    const output: VideoModelOutput = {
      bytes,
      mime,
      ...metadata,
      duration: metadata.duration ?? request.params.duration,
    };
    await ctx?.onProgress?.({
      phase: "downloading",
      progress: 1,
      provider_job_id: job.id,
    });
    return { job, output };
  }

  return {
    name: `openrouter:${model}`,
    capabilities,
    async generate(request, ctx): Promise<VideoModelResult> {
      const candidates = Math.max(1, request.params.candidates ?? 1);
      const jobs: OpenRouterVideoJob[] = [];
      const videos: VideoModelOutput[] = [];
      for (let index = 0; index < candidates; index += 1) {
        const result = await submit(request, ctx);
        jobs.push(result.job);
        videos.push(result.output);
      }
      return {
        videos,
        provider_job_ids: jobs.map((job) => job.id!),
        usage: {
          requests: jobs.length,
          seconds_generated: jobs.length * (request.params.duration ?? 0),
          cost_usd: jobs.reduce((sum, job) => sum + (job.usage?.cost ?? 0), 0),
        },
      };
    },
  };
}
