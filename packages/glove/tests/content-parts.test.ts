import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatOpenAIContentParts,
  OPENAI_MODALITIES,
  VISION_ONLY_MODALITIES,
  GEMINI_OPENAI_MODALITIES,
  audioFormat,
  extFromMediaType,
} from "../src/models/content";
import { formatAnthropicMessages } from "../src/models/anthropic";
import { providers } from "../src/models/providers";
import type { ContentPart, Message } from "../src/core";

const pdf: ContentPart = {
  type: "document",
  source: {
    type: "base64",
    media_type: "application/pdf",
    data: "BASE64DATA",
    filename: "invoice.pdf",
  },
};

// ─── OpenAI-shape formatter ────────────────────────────────────────────────────

test("document → native OpenAI file part with filename + data url", () => {
  const parts = formatOpenAIContentParts([pdf], OPENAI_MODALITIES) as any[];
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "file");
  assert.equal(parts[0].file.filename, "invoice.pdf");
  assert.equal(parts[0].file.file_data, "data:application/pdf;base64,BASE64DATA");
});

test("document falls back to a derived filename when none provided", () => {
  const noName: ContentPart = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: "X" },
  };
  const parts = formatOpenAIContentParts([noName], OPENAI_MODALITIES) as any[];
  assert.equal(parts[0].file.filename, "document.pdf");
});

test("vision-only provider degrades a document to a descriptive text note", () => {
  const parts = formatOpenAIContentParts([pdf], VISION_ONLY_MODALITIES) as any[];
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "text");
  assert.match(parts[0].text, /Attachment omitted/);
  assert.match(parts[0].text, /invoice\.pdf/);
});

test("Gemini (OpenAI shim) degrades documents but keeps images", () => {
  assert.equal(GEMINI_OPENAI_MODALITIES.document, false);
  const doc = formatOpenAIContentParts([pdf], GEMINI_OPENAI_MODALITIES) as any[];
  assert.equal(doc[0].type, "text");
});

test("audio → input_audio when supported", () => {
  const audio: ContentPart = {
    type: "audio",
    source: { type: "base64", media_type: "audio/wav", data: "AAAA" },
  };
  const parts = formatOpenAIContentParts([audio], OPENAI_MODALITIES) as any[];
  assert.equal(parts[0].type, "input_audio");
  assert.equal(parts[0].input_audio.format, "wav");
  assert.equal(parts[0].input_audio.data, "AAAA");
});

test("audio with an unsupported codec degrades to a note", () => {
  const audio: ContentPart = {
    type: "audio",
    source: { type: "base64", media_type: "audio/ogg", data: "AAAA" },
  };
  const parts = formatOpenAIContentParts([audio], OPENAI_MODALITIES) as any[];
  assert.equal(parts[0].type, "text");
  assert.match(parts[0].text, /unsupported audio format/);
});

test("video always degrades on the OpenAI shape (no video content part exists)", () => {
  const video: ContentPart = {
    type: "video",
    source: { type: "base64", media_type: "video/mp4", data: "AAAA" },
  };
  // Even when caps claim video, the OpenAI shape can't carry it.
  const parts = formatOpenAIContentParts([video], {
    ...OPENAI_MODALITIES,
    video: true,
  }) as any[];
  assert.equal(parts[0].type, "text");
});

test("image base64 → image_url data url; url image passes through", () => {
  const b64: ContentPart = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "PNG" },
  };
  const url: ContentPart = {
    type: "image",
    source: { type: "url", media_type: "image/png", url: "https://x/y.png" },
  };
  const parts = formatOpenAIContentParts([b64, url], OPENAI_MODALITIES) as any[];
  assert.equal(parts[0].image_url.url, "data:image/png;base64,PNG");
  assert.equal(parts[1].image_url.url, "https://x/y.png");
});

test("url media degrades when the provider rejects URL sources", () => {
  const url: ContentPart = {
    type: "image",
    source: { type: "url", media_type: "image/png", url: "https://x/y.png" },
  };
  const parts = formatOpenAIContentParts([url], {
    ...OPENAI_MODALITIES,
    urlSources: false,
  }) as any[];
  assert.equal(parts[0].type, "text");
});

// ─── Helpers ────────────────────────────────────────────────────────────────

test("audioFormat maps wav/mp3 and rejects others", () => {
  assert.equal(audioFormat("audio/wav"), "wav");
  assert.equal(audioFormat("audio/mpeg"), "mp3");
  assert.equal(audioFormat("audio/mp3"), "mp3");
  assert.equal(audioFormat("audio/ogg"), undefined);
  assert.equal(audioFormat(undefined), undefined);
});

test("extFromMediaType strips parameters and vendor suffixes", () => {
  assert.equal(extFromMediaType("application/pdf"), "pdf");
  assert.equal(extFromMediaType("image/svg+xml"), "svg");
  assert.equal(extFromMediaType("text/plain; charset=utf-8"), "plain");
});

// ─── Anthropic formatter ───────────────────────────────────────────────────────

test("anthropic document passes media_type through and titles from filename", () => {
  const msg: Message = { sender: "user", text: "", content: [pdf] };
  const formatted = formatAnthropicMessages([msg]);
  const content = (formatted[0] as any).content as any[];
  const doc = content.find((b) => b.type === "document");
  assert.ok(doc, "expected a document block");
  assert.equal(doc.source.media_type, "application/pdf");
  assert.equal(doc.title, "invoice.pdf");
});

test("anthropic degrades audio to a text note", () => {
  const msg: Message = {
    sender: "user",
    text: "",
    content: [{ type: "audio", source: { type: "base64", media_type: "audio/wav", data: "A" } }],
  };
  const content = (formatAnthropicMessages([msg])[0] as any).content as any[];
  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /Anthropic has no audio/);
});

// ─── Provider capability table ──────────────────────────────────────────────────

test("every provider declares a modalities capability set", () => {
  for (const [id, def] of Object.entries(providers)) {
    assert.ok(def.modalities, `provider ${id} is missing modalities`);
    for (const key of ["image", "document", "audio", "video", "urlSources"] as const) {
      assert.equal(
        typeof def.modalities[key],
        "boolean",
        `provider ${id} modalities.${key} should be boolean`,
      );
    }
  }
});

test("openai accepts documents; minimax does not", () => {
  assert.equal(providers.openai.modalities.document, true);
  assert.equal(providers.minimax.modalities.document, false);
});
