import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectMp4Metadata } from "../src/core/index";

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function box(type: string, ...contents: Uint8Array[]): Uint8Array {
  const content = concat(...contents);
  const output = new Uint8Array(content.length + 8);
  const view = new DataView(output.buffer);
  view.setUint32(0, output.length);
  output.set(new TextEncoder().encode(type), 4);
  output.set(content, 8);
  return output;
}

function track(handler: "vide" | "soun"): Uint8Array {
  const hdlr = new Uint8Array(12);
  hdlr.set(new TextEncoder().encode(handler), 8);
  if (handler === "soun") return box("trak", box("mdia", box("hdlr", hdlr)));

  const tkhd = new Uint8Array(16);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setUint32(8, 640 * 65_536);
  tkhdView.setUint32(12, 360 * 65_536);
  const mdhd = new Uint8Array(20);
  const mdhdView = new DataView(mdhd.buffer);
  mdhdView.setUint32(12, 24_000);
  mdhdView.setUint32(16, 60_000);
  return box(
    "trak",
    box("tkhd", tkhd),
    box("mdia", box("mdhd", mdhd), box("hdlr", hdlr)),
  );
}

test("inspectMp4Metadata reads video dimensions, duration, and audio tracks", () => {
  const bytes = box("moov", track("vide"), track("soun"));
  assert.deepEqual(inspectMp4Metadata(bytes), {
    width: 640,
    height: 360,
    duration: 2.5,
    has_audio: true,
  });
});

test("inspectMp4Metadata safely returns no claims for unknown bytes", () => {
  assert.deepEqual(inspectMp4Metadata(new Uint8Array([0, 1, 2, 3])), {});
});
