// OpenRouter image adapter — plain fetch, no SDK. Drives image-output
// models (e.g. google/gemini-2.5-flash-image) through the chat-completions
// endpoint with modalities: ["image", "text"]. Reference images ride as
// image_url content parts, which is also how edit() works: the base (and
// mask, and refs) go in as inputs alongside the instruction.

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
  fromDataUrl,
  toDataUrl,
} from "../core/index";

export interface OpenRouterImagesOptions {
  /** Defaults to process.env.OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Defaults to "google/gemini-2.5-flash-image". */
  model?: string;
  /** Defaults to "https://openrouter.ai/api/v1". */
  baseUrl?: string;
  /** Optional attribution headers. */
  referer?: string;
  title?: string;
}

interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

function refLabel(ref: ResolvedRef, index: number): string {
  switch (ref.role) {
    case "identity":
      return `Reference image ${index + 1}: identity — match this likeness exactly.`;
    case "style":
      return `Reference image ${index + 1}: style — match this visual style.`;
    case "composition":
      return `Reference image ${index + 1}: composition — match this framing and layout.`;
    case "content":
      return `Reference image ${index + 1}: base content to transform.`;
    case "mask":
      return `Reference image ${index + 1}: mask — white areas are editable, black areas must stay unchanged.`;
  }
}

export function openrouterImages(
  options: OpenRouterImagesOptions = {},
): ImageModelAdapter {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const model = options.model ?? "google/gemini-2.5-flash-image";
  const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";

  async function callOnce(
    parts: ChatContentPart[],
    extra: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<{ images: { bytes: Uint8Array; mime: string }[]; usage: ImageUsage }> {
    if (!apiKey) {
      throw new ImageError(
        "OpenRouter API key missing — pass apiKey or set OPENROUTER_API_KEY.",
      );
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: signal ?? null,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options.referer ? { "HTTP-Referer": options.referer } : {}),
        ...(options.title ? { "X-Title": options.title } : {}),
      },
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: parts }],
        // Ask OpenRouter to report token counts AND the actual USD cost
        // of the request in the response body.
        usage: { include: true },
        ...extra,
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new ImageError(`OpenRouter ${res.status}: ${body}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          images?: Array<{ type: string; image_url?: { url?: string } }>;
          content?: string;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { message?: string };
    };
    if (json.error?.message) throw new ImageError(`OpenRouter: ${json.error.message}`);
    const usage: ImageUsage = {
      requests: 1,
      tokens_in: json.usage?.prompt_tokens ?? 0,
      tokens_out: json.usage?.completion_tokens ?? 0,
      ...(json.usage?.cost !== undefined ? { cost_usd: json.usage.cost } : {}),
    };
    const images = json.choices?.[0]?.message?.images ?? [];
    if (images.length === 0) {
      const text = json.choices?.[0]?.message?.content?.slice(0, 300);
      throw new ImageError(
        `OpenRouter returned no images${text ? ` — model said: ${text}` : ""}`,
      );
    }
    return {
      images: images.map((img) => {
        const url = img.image_url?.url;
        if (!url) throw new ImageError("OpenRouter image entry missing image_url");
        return fromDataUrl(url);
      }),
      usage,
    };
  }

  function buildParts(prompt: string, refs: ResolvedRef[]): ChatContentPart[] {
    const parts: ChatContentPart[] = [];
    const labels = refs.map((r, i) => refLabel(r, i));
    const text = labels.length ? `${prompt}\n\n${labels.join("\n")}` : prompt;
    parts.push({ type: "text", text });
    for (const ref of refs) {
      parts.push({ type: "image_url", image_url: { url: toDataUrl(ref.bytes, ref.mime) } });
    }
    return parts;
  }

  return {
    name: `openrouter:${model}`,
    capabilities: {
      modes: ["generate", "edit"],
      maxRefs: 6,
      refRoles: ["identity", "style", "composition", "content", "mask"],
      sizes: "flexible",
      negativePrompt: false,
      seed: false,
      maxCandidates: 4,
    },
    async generate(
      req: ImageGenerateRequest,
      signal?: AbortSignal,
    ): Promise<ImageModelResult> {
      const parts = buildParts(req.prompt, req.refs);
      const n = Math.max(1, req.candidates ?? 1);
      // The chat endpoint returns one image per request — fan out for candidates.
      const batches = await Promise.all(
        Array.from({ length: n }, () => callOnce(parts, req.extra, signal)),
      );
      const usage = emptyUsage();
      for (const batch of batches) addUsage(usage, batch.usage);
      return { images: batches.flatMap((b) => b.images), usage };
    },
    async edit(req: ImageEditRequest, signal?: AbortSignal): Promise<ImageModelResult> {
      const refs: ResolvedRef[] = [
        { asset: "__base__", role: "content", bytes: req.base.bytes, mime: req.base.mime },
        ...(req.mask
          ? [{ asset: "__mask__", role: "mask" as const, bytes: req.mask.bytes, mime: req.mask.mime }]
          : []),
        ...req.refs,
      ];
      const parts = buildParts(
        `Edit the base image as instructed, changing nothing else: ${req.prompt}`,
        refs,
      );
      const { images, usage } = await callOnce(parts, req.extra, signal);
      return { images, usage };
    },
  };
}
