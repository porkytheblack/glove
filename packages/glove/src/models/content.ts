import type OpenAI from "openai";
import type { ContentPart, ModalitySupport } from "../core";

// ─── Per-family default modality capabilities ──────────────────────────────────
//
// These describe what each adapter can forward natively when the caller hasn't
// supplied a more specific capability set (e.g. constructing an adapter directly
// instead of via `createAdapter`, which threads `providerDef.modalities`).

/** Real-OpenAI baseline: images, PDFs (file part), audio (input_audio); no video. */
export const OPENAI_MODALITIES: ModalitySupport = {
  image: true,
  document: true,
  audio: true,
  video: false,
  urlSources: true,
};

/** Anthropic: images + PDFs (base64 or URL); no audio/video. */
export const ANTHROPIC_MODALITIES: ModalitySupport = {
  image: true,
  document: true,
  audio: false,
  video: false,
  urlSources: true,
};

/** Bedrock Converse: base64 images, documents, and video; no URL sources, no audio. */
export const BEDROCK_MODALITIES: ModalitySupport = {
  image: true,
  document: true,
  audio: false,
  video: true,
  urlSources: false,
};

/**
 * Xiaomi MiMo (omni models): images + audio over the OpenAI wire shape.
 * Video is reported as unsupported because the OpenAI Chat Completions schema
 * (which MiMo speaks) has no video content part — it would only degrade to a note.
 */
export const MIMO_MODALITIES: ModalitySupport = {
  image: true,
  document: false,
  audio: true,
  video: false,
  urlSources: true,
};

/** Vision-capable providers that accept images but no documents/audio/video. */
export const VISION_ONLY_MODALITIES: ModalitySupport = {
  image: true,
  document: false,
  audio: false,
  video: false,
  urlSources: true,
};

/**
 * Google Gemini via its OpenAI-compatibility shim: images and inline audio.
 * PDFs/documents go through Gemini's native API, not the OpenAI `file` part,
 * so they're reported unsupported here and degrade to a text note.
 */
export const GEMINI_OPENAI_MODALITIES: ModalitySupport = {
  image: true,
  document: false,
  audio: true,
  video: false,
  urlSources: true,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Map an audio media_type to OpenAI's `input_audio.format` enum. */
export function audioFormat(mediaType?: string): "wav" | "mp3" | undefined {
  if (!mediaType) return undefined;
  const mt = mediaType.toLowerCase();
  if (mt.includes("wav")) return "wav";
  if (mt.includes("mpeg") || mt.includes("mp3")) return "mp3";
  return undefined;
}

/** Best-effort file extension from a media type, for filename fallbacks. */
export function extFromMediaType(mediaType?: string): string {
  if (!mediaType) return "bin";
  if (mediaType === "application/pdf") return "pdf";
  const slash = mediaType.indexOf("/");
  const ext = slash >= 0 ? mediaType.slice(slash + 1) : mediaType;
  // Strip parameters like "; charset=utf-8" and vendor prefixes.
  return ext.split(";")[0].split("+")[0] || "bin";
}

/** Human-readable note for a part a provider can't accept, kept in-context as text. */
export function unsupportedAttachmentNote(part: ContentPart, reason: string): string {
  const label = part.source?.filename ?? part.source?.media_type ?? part.type;
  return `[Attachment omitted: ${label} (${part.type}) — ${reason}]`;
}

// ─── OpenAI-shape formatter (openai-compat / openrouter / mimo) ────────────────

/**
 * Format Glove `ContentPart`s into OpenAI Chat Completions content parts,
 * honouring the adapter's modality `caps`. Anything unsupported degrades to a
 * descriptive text note rather than a malformed request.
 */
export function formatOpenAIContentParts(
  parts: ContentPart[],
  caps: ModalitySupport = OPENAI_MODALITIES,
): OpenAI.Chat.ChatCompletionContentPart[] {
  const out: OpenAI.Chat.ChatCompletionContentPart[] = [];

  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.text) out.push({ type: "text", text: part.text });
        break;

      case "image": {
        if (!part.source) break;
        if (!caps.image) {
          out.push(note(part, "provider does not accept image input"));
          break;
        }
        if (part.source.type === "url") {
          if (!caps.urlSources) {
            out.push(note(part, "provider does not accept URL media sources"));
            break;
          }
          out.push({ type: "image_url", image_url: { url: part.source.url! } });
        } else {
          out.push({
            type: "image_url",
            image_url: {
              url: `data:${part.source.media_type};base64,${part.source.data}`,
            },
          });
        }
        break;
      }

      case "document": {
        if (!part.source) break;
        if (!caps.document) {
          out.push(note(part, "provider does not accept document input"));
          break;
        }
        if (part.source.type === "url") {
          // OpenAI's `file` part takes base64 `file_data` or a `file_id`, not an
          // arbitrary URL. Surface the link as text so the model can still act on it.
          out.push({
            type: "text",
            text: `[Document: ${part.source.filename ?? part.source.media_type} at ${part.source.url}]`,
          });
          break;
        }
        out.push({
          type: "file",
          file: {
            filename:
              part.source.filename ??
              `document.${extFromMediaType(part.source.media_type)}`,
            file_data: `data:${part.source.media_type};base64,${part.source.data}`,
          },
        });
        break;
      }

      case "audio": {
        if (!part.source) break;
        const fmt = audioFormat(part.source.media_type);
        if (!caps.audio || part.source.type !== "base64" || !fmt) {
          const reason = !caps.audio
            ? "provider does not accept audio input"
            : part.source.type !== "base64"
              ? "audio must be inline base64"
              : `unsupported audio format ${part.source.media_type} (use wav or mp3)`;
          out.push(note(part, reason));
          break;
        }
        out.push({
          type: "input_audio",
          input_audio: { data: part.source.data!, format: fmt },
        });
        break;
      }

      case "video":
        // The OpenAI Chat Completions schema has no video content part. Even
        // providers that accept video do so through their native API, so always
        // degrade here.
        out.push(note(part, "OpenAI-compatible APIs have no video content part"));
        break;
    }
  }

  return out;
}

function note(
  part: ContentPart,
  reason: string,
): OpenAI.Chat.ChatCompletionContentPartText {
  return { type: "text", text: unsupportedAttachmentNote(part, reason) };
}
