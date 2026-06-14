import type { ContentPart, Modality } from "glove-core/core";

/**
 * A file the user attaches to a message. Mirrors the simple `{ data, media_type }`
 * image shape `sendMessage` already accepted, generalised to any modality.
 *
 * `data` is base64 (no `data:` prefix) when `sourceType` is "base64" (the
 * default), or a URL when `sourceType` is "url".
 */
export interface MessageAttachment {
  /** base64 payload (no `data:` prefix) or a URL — see `sourceType`. */
  data: string;
  /** MIME type, e.g. "application/pdf", "image/png", "audio/wav". */
  media_type: string;
  /** Original filename. Forwarded to providers that need it (OpenAI file parts). */
  filename?: string;
  /**
   * Which modality this is. Inferred from `media_type` when omitted
   * (image/* → image, audio/* → audio, video/* → video, everything else → document).
   */
  kind?: Modality;
  /** "base64" (default) or "url". */
  sourceType?: "base64" | "url";
}

/** Infer the modality of an attachment from its MIME type. */
export function inferModality(mediaType: string): Modality {
  const mt = mediaType.toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("audio/")) return "audio";
  if (mt.startsWith("video/")) return "video";
  return "document";
}

/** Convert a {@link MessageAttachment} into a Glove `ContentPart`. */
export function attachmentToContentPart(att: MessageAttachment): ContentPart {
  const kind = att.kind ?? inferModality(att.media_type);
  const sourceType = att.sourceType ?? "base64";
  return {
    type: kind,
    source: {
      type: sourceType,
      media_type: att.media_type,
      ...(sourceType === "url" ? { url: att.data } : { data: att.data }),
      ...(att.filename ? { filename: att.filename } : {}),
    },
  };
}

/** Build a `data:` URL (or pass through a URL source) for previewing an attachment. */
export function attachmentPreviewUrl(att: MessageAttachment): string {
  const sourceType = att.sourceType ?? "base64";
  return sourceType === "url" ? att.data : `data:${att.media_type};base64,${att.data}`;
}
