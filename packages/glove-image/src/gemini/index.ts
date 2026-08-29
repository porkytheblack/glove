import {
  type ImageEditRequest,
  type ImageGenerateRequest,
  type ImageModelAdapter,
  type ImageModelResult,
  type ImageUsage,
  type ResolvedRef,
  ImageError,
  addUsage,
  emptyUsage,
} from "../core/index";

export interface GeminiImagesOptions {
  /** Defaults to process.env.GEMINI_API_KEY. Credential acquisition stays with the host. */
  apiKey?: string;
  /** Defaults to the current Gemini native image model. */
  model?: string;
  /** Defaults to the public Gemini REST API. */
  baseUrl?: string;
  /** Injectable for tests, proxies, and edge runtimes. */
  fetch?: typeof globalThis.fetch;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string };
}

function roleInstruction(ref: ResolvedRef, index: number): string {
  const purpose = {
    identity: "preserve this identity exactly",
    style: "use this visual language, without copying unrelated content",
    composition: "follow this framing and spatial rhythm",
    content: "use this as source content to transform",
    mask: "treat light areas as editable and dark areas as protected",
  }[ref.role];
  return `Reference ${index + 1}: ${purpose}.`;
}

function aspectRatio(size?: string): string | undefined {
  if (!size) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return undefined;
  const supported = [
    [1, 1], [2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4], [9, 16], [16, 9], [21, 9],
  ] as const;
  const ratio = width / height;
  const nearest = supported.reduce((best, value) =>
    Math.abs(value[0] / value[1] - ratio) < Math.abs(best[0] / best[1] - ratio) ? value : best,
  );
  return `${nearest[0]}:${nearest[1]}`;
}

export function geminiImages(options: GeminiImagesOptions = {}): ImageModelAdapter {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? "gemini-3.1-flash-image";
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1").replace(/\/$/, "");
  const fetcher = options.fetch ?? globalThis.fetch;

  async function callOnce(
    prompt: string,
    refs: ResolvedRef[],
    size: string | undefined,
    extra: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<ImageModelResult> {
    if (!apiKey) {
      throw new ImageError("Gemini API key missing — pass apiKey or set GEMINI_API_KEY.");
    }
    const ratio = aspectRatio(size);
    const labels = refs.map(roleInstruction);
    const parts: GeminiPart[] = [
      { text: labels.length ? `${prompt}\n\n${labels.join("\n")}` : prompt },
      ...refs.map((ref) => ({
        inlineData: { mimeType: ref.mime, data: Buffer.from(ref.bytes).toString("base64") },
      })),
    ];
    const response = await fetcher(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: signal ?? null,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          ...extra,
          contents: [{ role: "user", parts }],
          generationConfig: {
            ...((extra?.generationConfig as Record<string, unknown> | undefined) ?? {}),
            responseModalities: ["IMAGE"],
            ...(ratio ? { imageConfig: { aspectRatio: ratio } } : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      const body = (await response.text()).slice(0, 600);
      throw new ImageError(`Gemini ${response.status}: ${body}`);
    }
    const json = (await response.json()) as GeminiResponse;
    if (json.error?.message) throw new ImageError(`Gemini: ${json.error.message}`);
    const responseParts = json.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
    const images = responseParts
      .filter((part) => !part.thought && part.inlineData?.data)
      .map((part) => ({
        bytes: new Uint8Array(Buffer.from(part.inlineData!.data!, "base64")),
        mime: part.inlineData?.mimeType ?? "image/png",
      }));
    if (images.length === 0) {
      const text = responseParts.find((part) => !part.thought && part.text)?.text?.slice(0, 300);
      throw new ImageError(`Gemini returned no final image${text ? ` — model said: ${text}` : ""}.`);
    }
    const usage: ImageUsage = {
      requests: 1,
      tokens_in: json.usageMetadata?.promptTokenCount ?? 0,
      tokens_out: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
    const revised_prompt = responseParts
      .filter((part) => !part.thought && part.text)
      .map((part) => part.text)
      .join("\n") || undefined;
    return { images, usage, ...(revised_prompt ? { revised_prompt } : {}) };
  }

  const generate = async (req: ImageGenerateRequest, signal?: AbortSignal): Promise<ImageModelResult> => {
    const count = Math.max(1, req.candidates ?? 1);
    const batches = await Promise.all(
      Array.from({ length: count }, () => callOnce(req.prompt, req.refs, req.size, req.extra, signal)),
    );
    const usage = emptyUsage();
    for (const batch of batches) addUsage(usage, batch.usage);
    return {
      images: batches.flatMap((batch) => batch.images),
      usage,
      revised_prompt: batches.find((batch) => batch.revised_prompt)?.revised_prompt,
    };
  };

  return {
    name: `gemini:${model}`,
    capabilities: {
      modes: ["generate", "edit"],
      maxRefs: 14,
      refRoles: ["identity", "style", "composition", "content", "mask"],
      sizes: "flexible",
      negativePrompt: false,
      seed: false,
      maxCandidates: 4,
    },
    generate,
    async edit(req: ImageEditRequest, signal?: AbortSignal): Promise<ImageModelResult> {
      const refs: ResolvedRef[] = [
        { asset: "__base__", role: "content", bytes: req.base.bytes, mime: req.base.mime },
        ...(req.mask ? [{ asset: "__mask__", role: "mask" as const, bytes: req.mask.bytes, mime: req.mask.mime }] : []),
        ...req.refs,
      ];
      return callOnce(
        `Edit the supplied base image according to this direction. Preserve everything not named for change. ${req.prompt}`,
        refs,
        req.size,
        req.extra,
        signal,
      );
    },
  };
}
