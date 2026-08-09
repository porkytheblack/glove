/**
 * env:images, exercised from inside scripts.
 *
 * Fixtures are generated with sharp rather than checked in as binaries, so
 * every expectation is derived from something visible in the test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { assertAdapterOk, createAdapterTestEnv, type AdapterTestEnv } from "glove-working-environment/testing";
import { images } from "../src/index";
import type { ImageStats, ImageSummary } from "../src/index";

async function env(): Promise<AdapterTestEnv> {
  return createAdapterTestEnv(images());
}

interface SolidOptions {
  width?: number;
  height?: number;
  colour?: { r: number; g: number; b: number; alpha: number };
  format?: "png" | "jpeg" | "webp";
}

async function solid(opts: SolidOptions = {}): Promise<Uint8Array> {
  const pipeline = sharp({
    create: {
      width: opts.width ?? 40,
      height: opts.height ?? 20,
      channels: 4,
      background: opts.colour ?? { r: 200, g: 30, b: 30, alpha: 1 },
    },
  });
  const buf = await (opts.format === "jpeg" ? pipeline.jpeg() : opts.format === "webp" ? pipeline.webp() : pipeline.png()).toBuffer();
  return new Uint8Array(buf);
}

/**
 * An animated GIF whose frames are distinguishable: frame i is solid
 * (i × 60, 10, 10), so both the count AND the order can be asserted.
 */
async function animatedGif(frames = 4, width = 40, height = 20): Promise<Uint8Array> {
  const pages: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    pages.push(
      await sharp({ create: { width, height, channels: 3, background: { r: i * 60, g: 10, b: 10 } } }).png().toBuffer(),
    );
  }
  return new Uint8Array(await sharp(pages, { join: { animated: true } }).gif().toBuffer());
}

/** A 100×50 SVG — text, not pixels, until something rasterizes it. */
function svg(): Uint8Array {
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><circle cx="50" cy="25" r="24" fill="#3366cc"/></svg>`,
  );
}

/** Read an output back host-side, so assertions do not depend on the adapter. */
async function meta(t: AdapterTestEnv, path: string) {
  return sharp(Buffer.from(await t.fs.readBytes(path))).metadata();
}

/** Every frame's red channel, sampled at the centre of each frame. */
async function frameReds(t: AdapterTestEnv, path: string): Promise<number[]> {
  const bytes = Buffer.from(await t.fs.readBytes(path));
  const m = await sharp(bytes, { animated: true }).metadata();
  const raw = await sharp(bytes, { animated: true }).raw().toBuffer({ resolveWithObject: true });
  const pageHeight = m.pageHeight ?? m.height ?? 0;
  const reds: number[] = [];
  for (let page = 0; page < (m.pages ?? 1); page++) {
    const y = page * pageHeight + Math.floor(pageHeight / 2);
    const x = Math.floor((m.width ?? 0) / 2);
    reds.push(raw.data[(y * raw.info.width + x) * raw.info.channels]);
  }
  return reds;
}

test("the adapter passes its own audit", async () => {
  const t = await env();
  assertAdapterOk(await t.audit());
});

test("describe answers what an image is without decoding it into context", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/red.png", await solid({ width: 64, height: 48 }));
  const out = await t.script<ImageSummary>(
    `import { describe } from 'env:images';
     export default async function main() { return describe('/inbox/red.png'); }`,
  );
  assert.equal(out.path, "/inbox/red.png");
  assert.equal(out.format, "png");
  assert.equal(out.width, 64);
  assert.equal(out.height, 48);
  assert.equal(out.space, "srgb");
  assert.equal(out.hasAlpha, true);
  assert.equal(out.pages, 1);
  assert.ok(out.bytes > 0);
  assert.ok(JSON.stringify(out).length < 400, "describe must stay tokens-cheap");
});

test("describe reports a JPEG as opaque with three channels", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/photo.jpg", await solid({ format: "jpeg" }));
  const out = await t.script<ImageSummary>(
    `import { describe } from 'env:images';
     export default async function main() { return describe('/inbox/photo.jpg'); }`,
  );
  assert.equal(out.format, "jpeg");
  assert.equal(out.channels, 3);
  assert.equal(out.hasAlpha, false);
});

test("resize honours the box and returns the output path", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/big.png", await solid({ width: 400, height: 200 }));
  const out = await t.script<string>(
    `import { resize } from 'env:images';
     export default async function main() { return resize('/inbox/big.png', '/out/small.png', { width: 100, height: 50 }); }`,
  );
  assert.equal(out, "/out/small.png");
  const m = await meta(t, "/out/small.png");
  assert.equal(m.width, 100);
  assert.equal(m.height, 50);
});

test("fit: inside preserves aspect ratio; withoutEnlargement refuses to upscale", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/wide.png", await solid({ width: 400, height: 100 }));
  await t.script(
    `import { resize } from 'env:images';
     export default async function main() {
       await resize('/inbox/wide.png', '/out/inside.png', { width: 200, height: 200, fit: 'inside' });
       await resize('/inbox/wide.png', '/out/nogrow.png', { width: 4000, withoutEnlargement: true });
     }`,
  );
  const inside = await meta(t, "/out/inside.png");
  assert.deepEqual([inside.width, inside.height], [200, 50], "inside keeps the 4:1 ratio");
  const nogrow = await meta(t, "/out/nogrow.png");
  assert.equal(nogrow.width, 400, "withoutEnlargement leaves a smaller image alone");
});

test("resize needs at least one dimension", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid());
  const run = await t.runScript(
    `import { resize } from 'env:images';
     export default async function main() { return resize('/inbox/a.png', '/out/a.png', {}); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /^env:images\.resize: /);
  assert.match(run.error ?? "", /needs a width, a height, or both/);
});

test("the output extension picks the encoder", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid());
  await t.script(
    `import { convert, resize } from 'env:images';
     export default async function main() {
       await convert('/inbox/a.png', '/out/a.webp');
       await convert('/inbox/a.png', '/out/a.jpg', { quality: 60 });
       await resize('/inbox/a.png', '/out/a.avif', { width: 10 });
     }`,
  );
  assert.equal((await meta(t, "/out/a.webp")).format, "webp");
  assert.equal((await meta(t, "/out/a.jpg")).format, "jpeg");
  assert.equal((await meta(t, "/out/a.avif")).format, "heif", "avif is reported as heif by libvips");
});

test("an explicit format overrides the extension", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid());
  await t.script(
    `import { convert } from 'env:images';
     export default async function main() { return convert('/inbox/a.png', '/out/mislabelled.bin', { format: 'webp' }); }`,
  );
  assert.equal((await meta(t, "/out/mislabelled.bin")).format, "webp");
});

test("an unguessable output format is refused with the list of options", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid());
  const run = await t.runScript(
    `import { convert } from 'env:images';
     export default async function main() { return convert('/inbox/a.png', '/out/mystery'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /cannot tell what format to write/);
  assert.match(run.error ?? "", /\.png, \.jpg, \.webp/);
});

test("quality actually changes the encoded size", async () => {
  const t = await env();
  // Noise, not a flat colour: a solid block compresses identically at any
  // quality and the assertion would be vacuous.
  const noise = Buffer.alloc(120 * 120 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
  const png = await sharp(noise, { raw: { width: 120, height: 120, channels: 3 } }).png().toBuffer();
  await t.fs.writeFile("/inbox/noise.png", new Uint8Array(png));

  await t.script(
    `import { convert } from 'env:images';
     export default async function main() {
       await convert('/inbox/noise.png', '/out/low.jpg', { quality: 20 });
       await convert('/inbox/noise.png', '/out/high.jpg', { quality: 95 });
     }`,
  );
  const low = (await t.fs.stat("/out/low.jpg"))?.size ?? 0;
  const high = (await t.fs.stat("/out/high.jpg"))?.size ?? 0;
  assert.ok(low < high, `quality 20 (${low}B) should be smaller than quality 95 (${high}B)`);
});

test("crop extracts the requested rectangle", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/big.png", await solid({ width: 100, height: 100 }));
  await t.script(
    `import { crop } from 'env:images';
     export default async function main() { return crop('/inbox/big.png', '/out/piece.png', { left: 10, top: 20, width: 30, height: 40 }); }`,
  );
  const m = await meta(t, "/out/piece.png");
  assert.deepEqual([m.width, m.height], [30, 40]);
});

test("crop validates its box instead of passing nonsense to the library", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid());
  for (const [box, pattern] of [
    ["{ left: 0, top: 0, width: 0, height: 5 }", /must be positive/],
    ["{ left: 0, top: 0, height: 5 }", /needs a numeric width/],
  ] as const) {
    const run = await t.runScript(
      `import { crop } from 'env:images';
       export default async function main() { return crop('/inbox/a.png', '/out/x.png', ${box}); }`,
    );
    assert.equal(run.ok, false);
    assert.match(run.error ?? "", pattern);
  }
});

test("rotate by an angle swaps the axes", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/wide.png", await solid({ width: 60, height: 20 }));
  await t.script(
    `import { rotate } from 'env:images';
     export default async function main() { return rotate('/inbox/wide.png', '/out/turned.png', { angle: 90 }); }`,
  );
  const m = await meta(t, "/out/turned.png");
  assert.deepEqual([m.width, m.height], [20, 60]);
});

test("rotate with no angle auto-orients from EXIF", async () => {
  const t = await env();
  // Orientation 6 means "stored sideways"; auto-orient must apply it.
  const oriented = await sharp({ create: { width: 60, height: 20, channels: 3, background: "#888888" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  await t.fs.writeFile("/inbox/sideways.jpg", new Uint8Array(oriented));

  const before = await t.script<ImageSummary>(
    `import { describe } from 'env:images';
     export default async function main() { return describe('/inbox/sideways.jpg'); }`,
  );
  assert.equal(before.orientation, 6, "describe surfaces the EXIF flag so a script knows to normalise");

  await t.script(
    `import { rotate } from 'env:images';
     export default async function main() { return rotate('/inbox/sideways.jpg', '/out/upright.jpg'); }`,
  );
  const m = await meta(t, "/out/upright.jpg");
  assert.deepEqual([m.width, m.height], [20, 60], "the stored pixels are now upright");
});

test("stats distinguishes a blank page from a real one", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/blank.png", await solid({ colour: { r: 255, g: 255, b: 255, alpha: 1 } }));
  const noise = Buffer.alloc(60 * 60 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 256;
  await t.fs.writeFile(
    "/inbox/busy.png",
    new Uint8Array(await sharp(noise, { raw: { width: 60, height: 60, channels: 3 } }).png().toBuffer()),
  );

  const out = await t.script<{ blank: ImageStats; busy: ImageStats }>(
    `import { stats } from 'env:images';
     export default async function main() {
       return { blank: await stats('/inbox/blank.png'), busy: await stats('/inbox/busy.png') };
     }`,
  );
  assert.ok(out.blank.meanBrightness > 250, `blank page mean ${out.blank.meanBrightness}`);
  assert.ok(out.blank.channels.slice(0, 3).every((c) => c.stdev < 1));
  assert.ok(out.busy.channels.slice(0, 3).some((c) => c.stdev > 20), "noise has real spread");
  assert.match(out.blank.dominant, /^#[0-9a-f]{6}$/);
});

test("stats ignores alpha when averaging brightness", async () => {
  const t = await env();
  // Fully transparent white: alpha 0 would drag a naive mean to ~191.
  await t.fs.writeFile("/inbox/ghost.png", await solid({ colour: { r: 255, g: 255, b: 255, alpha: 0 } }));
  const out = await t.script<ImageStats>(
    `import { stats } from 'env:images';
     export default async function main() { return stats('/inbox/ghost.png'); }`,
  );
  assert.ok(out.meanBrightness > 250, `expected a white reading, got ${out.meanBrightness}`);
  assert.equal(out.isOpaque, false);
});

test("thumbnail produces a square", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/wide.png", await solid({ width: 300, height: 100 }));
  await t.script(
    `import { thumbnail } from 'env:images';
     export default async function main() { return thumbnail('/inbox/wide.png', '/out/thumb.png', 64); }`,
  );
  const m = await meta(t, "/out/thumb.png");
  assert.deepEqual([m.width, m.height], [64, 64]);
});

test("composite lays a layer over a base", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/base.png", await solid({ width: 100, height: 100, colour: { r: 0, g: 0, b: 0, alpha: 1 } }));
  await t.fs.writeFile("/inbox/dot.png", await solid({ width: 20, height: 20, colour: { r: 255, g: 255, b: 255, alpha: 1 } }));

  await t.script(
    `import { composite } from 'env:images';
     export default async function main() {
       return composite('/inbox/base.png', '/out/stacked.png', [{ input: '/inbox/dot.png', left: 0, top: 0 }]);
     }`,
  );
  const m = await meta(t, "/out/stacked.png");
  assert.deepEqual([m.width, m.height], [100, 100], "the base keeps its size");

  // The top-left corner is now white; the bottom-right is still black.
  const raw = await sharp(Buffer.from(await t.fs.readBytes("/out/stacked.png"))).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => raw.data[(y * raw.info.width + x) * raw.info.channels];
  assert.ok(px(5, 5) > 200, "the layer landed");
  assert.ok(px(95, 95) < 50, "and did not cover everything");
});

test("composite honours gravity and opacity", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/base.png", await solid({ width: 100, height: 100, colour: { r: 0, g: 0, b: 0, alpha: 1 } }));
  await t.fs.writeFile("/inbox/dot.png", await solid({ width: 20, height: 20, colour: { r: 255, g: 255, b: 255, alpha: 1 } }));

  await t.script(
    `import { composite } from 'env:images';
     export default async function main() {
       return composite('/inbox/base.png', '/out/se.png', [
         { input: '/inbox/dot.png', gravity: 'southeast', opacity: 0.5 },
       ]);
     }`,
  );
  const raw = await sharp(Buffer.from(await t.fs.readBytes("/out/se.png"))).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => raw.data[(y * raw.info.width + x) * raw.info.channels];
  const corner = px(95, 95);
  assert.ok(corner > 50 && corner < 220, `a half-opacity white on black should land mid-grey, got ${corner}`);
  assert.ok(px(5, 5) < 50, "the opposite corner is untouched");
});

test("composite rejects an empty or malformed layer list", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/base.png", await solid());
  for (const [layers, pattern] of [
    ["[]", /at least one layer/],
    ["[{ left: 0 }]", /needs an \{ input \} path/],
  ] as const) {
    const run = await t.runScript(
      `import { composite } from 'env:images';
       export default async function main() { return composite('/inbox/base.png', '/out/x.png', ${layers}); }`,
    );
    assert.equal(run.ok, false);
    assert.match(run.error ?? "", pattern);
  }
});

test("contactSheet tiles a set into one grid", async () => {
  const t = await env();
  for (let i = 0; i < 5; i++) {
    await t.fs.writeFile(`/inbox/i${i}.png`, await solid({ width: 30 + i, height: 30 }));
  }
  const out = await t.script<string>(
    `import { glob } from 'env:fs';
     import { contactSheet } from 'env:images';
     export default async function main() {
       const paths = (await glob('/inbox/*.png')).sort();
       return contactSheet(paths, '/out/sheet.png', { cell: 50, columns: 3 });
     }`,
  );
  assert.equal(out, "/out/sheet.png");
  const m = await meta(t, "/out/sheet.png");
  // 5 images, 3 columns → 2 rows.
  assert.deepEqual([m.width, m.height], [150, 100]);
});

test("a file that is not an image fails with the path in the message", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/notes.txt", "definitely not an image");
  const run = await t.runScript(
    `import { describe } from 'env:images';
     export default async function main() { return describe('/inbox/notes.txt'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /^env:images\.describe: /);
  assert.match(run.error ?? "", /\/inbox\/notes\.txt/);
});

test("outputs land in the tree and obey the environment's limits", async () => {
  const t = await createAdapterTestEnv(images(), { limits: { maxFileBytes: 2048 } });
  await t.fs.writeFile("/inbox/src.png", await solid({ width: 20, height: 20 }));
  const run = await t.runScript(
    `import { resize } from 'env:images';
     export default async function main() { return resize('/inbox/src.png', '/out/huge.png', { width: 2000, height: 2000 }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /maxFileBytes/);
  assert.equal(await t.fs.exists("/out/huge.png"), false);
});

// ================================================================ animation

/** Frame colours survive a re-encode, but a palette is not bit-exact. */
function assertFrames(actual: number[], expected: number[], why: string): void {
  assert.equal(actual.length, expected.length, `${why}: got ${actual.length} frames, expected ${expected.length}`);
  for (const [i, want] of expected.entries()) {
    assert.ok(Math.abs(actual[i] - want) <= 4, `${why}: frame ${i} was ${actual[i]}, expected about ${want}`);
  }
}

test("an animated GIF round-trips through resize with its frames intact", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4, 40, 20));

  const out = await t.script<{ before: ImageSummary; after: ImageSummary }>(
    `import { describe, resize } from 'env:images';
     export default async function main() {
       const before = await describe('/inbox/loop.gif');
       await resize('/inbox/loop.gif', '/out/small.gif', { width: 20, height: 10 });
       return { before, after: await describe('/out/small.gif') };
     }`,
  );
  assert.equal(out.before.pages, 4, "describe must see four frames going in");
  assert.equal(out.after.pages, 4, "and four coming out — this is the whole bug");
  assert.deepEqual([out.after.width, out.after.height], [20, 10], "dimensions are one frame's, not the strip's");
  assertFrames(await frameReds(t, "/out/small.gif"), [0, 60, 120, 180], "resize");
});

test("frames survive a convert into another animated format, in order", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4));
  await t.script(
    `import { convert } from 'env:images';
     export default async function main() { return convert('/inbox/loop.gif', '/out/loop.webp'); }`,
  );
  assert.equal((await meta(t, "/out/loop.webp")).format, "webp");
  assertFrames(await frameReds(t, "/out/loop.webp"), [0, 60, 120, 180], "convert to webp");
});

test("a still output format takes frame one, not a strip of all of them", async () => {
  // The failure mode decoding every frame introduces: libvips holds them as one
  // tall image, and a PNG encoder writes that tall image rather than flattening.
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4, 40, 20));
  await t.script(
    `import { convert, resize } from 'env:images';
     export default async function main() {
       await convert('/inbox/loop.gif', '/out/one.png');
       await resize('/inbox/loop.gif', '/out/one.jpg', { width: 20 });
     }`,
  );
  const png = await meta(t, "/out/one.png");
  assert.deepEqual([png.width, png.height], [40, 20], "a 4-frame GIF must not become an 80px-tall PNG");
  assertFrames(await frameReds(t, "/out/one.png"), [0], "flattened png");
  const jpg = await meta(t, "/out/one.jpg");
  assert.deepEqual([jpg.width, jpg.height], [20, 10]);
});

test("animated: false flattens on purpose, even into a format that could hold frames", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4));
  const after = await t.script<ImageSummary>(
    `import { describe, resize } from 'env:images';
     export default async function main() {
       await resize('/inbox/loop.gif', '/out/first.gif', { width: 20, animated: false });
       return describe('/out/first.gif');
     }`,
  );
  assert.equal(after.pages, 1);
});

test("crop and thumbnail keep the frames, and the box is measured against one of them", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4, 40, 20));
  await t.script(
    `import { crop, thumbnail } from 'env:images';
     export default async function main() {
       await crop('/inbox/loop.gif', '/out/piece.gif', { left: 5, top: 5, width: 10, height: 10 });
       await thumbnail('/inbox/loop.gif', '/out/thumb.gif', 16);
     }`,
  );
  const piece = await meta(t, "/out/piece.gif");
  assert.deepEqual([piece.width, piece.height], [10, 10], "the crop is a frame-sized rectangle");
  assertFrames(await frameReds(t, "/out/piece.gif"), [0, 60, 120, 180], "crop");
  assertFrames(await frameReds(t, "/out/thumb.gif"), [0, 60, 120, 180], "thumbnail");
});

test("a crop box past the edge of a frame says so instead of saying 'bad extract area'", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4, 40, 20));
  const run = await t.runScript(
    `import { crop } from 'env:images';
     export default async function main() { return crop('/inbox/loop.gif', '/out/x.gif', { left: 0, top: 15, width: 10, height: 10 }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /falls outside 40×20 \(one of 4 frames\)/);
});

test("rotate refuses an animation rather than reversing its frames", async () => {
  // libvips rotates the strip, not the frames: a quarter turn is unsupported
  // and a half turn plays the animation backwards. Both are worth a refusal.
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4));
  const run = await t.runScript(
    `import { rotate } from 'env:images';
     export default async function main() { return rotate('/inbox/loop.gif', '/out/turned.gif', { angle: 90 }); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /has 4 frames and libvips cannot rotate a multi-page image/);
  assert.match(run.error ?? "", /\{ animated: false \}/, "the refusal has to name the way out");

  const summary = await t.script<ImageSummary>(
    `import { describe, rotate } from 'env:images';
     export default async function main() {
       await rotate('/inbox/loop.gif', '/out/turned.gif', { angle: 90, animated: false });
       return describe('/out/turned.gif');
     }`,
  );
  assert.deepEqual([summary.width, summary.height, summary.pages], [20, 40, 1]);
});

test("a watermark lands on every frame, not just the first", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(4, 60, 40));
  await t.fs.writeFile("/inbox/dot.png", await solid({ width: 8, height: 8, colour: { r: 255, g: 255, b: 255, alpha: 1 } }));
  await t.script(
    `import { composite } from 'env:images';
     export default async function main() {
       return composite('/inbox/loop.gif', '/out/marked.gif', [{ input: '/inbox/dot.png', gravity: 'northwest' }]);
     }`,
  );
  const bytes = Buffer.from(await t.fs.readBytes("/out/marked.gif"));
  const m = await sharp(bytes, { animated: true }).metadata();
  assert.equal(m.pages, 4, "the animation survived the composite");
  const raw = await sharp(bytes, { animated: true }).raw().toBuffer({ resolveWithObject: true });
  for (let page = 0; page < 4; page++) {
    const y = page * (m.pageHeight ?? 0) + 2;
    const px = raw.data[(y * raw.info.width + 2) * raw.info.channels];
    assert.ok(px > 200, `frame ${page} should carry the mark, read ${px}`);
  }
});

test("still images are untouched by any of this", async () => {
  // The animated read is a different libvips code path; the regression to guard
  // against is it changing what a plain PNG does.
  const t = await env();
  await t.fs.writeFile("/inbox/wide.png", await solid({ width: 60, height: 20 }));
  await t.script(
    `import { resize, rotate, crop, thumbnail } from 'env:images';
     export default async function main() {
       await resize('/inbox/wide.png', '/out/r.gif', { width: 30, height: 10 });
       await rotate('/inbox/wide.png', '/out/t.png', { angle: 90 });
       await crop('/inbox/wide.png', '/out/c.png', { left: 1, top: 1, width: 10, height: 5 });
       await thumbnail('/inbox/wide.png', '/out/th.gif', 16);
     }`,
  );
  const r = await meta(t, "/out/r.gif");
  assert.deepEqual([r.width, r.height, r.pages], [30, 10, 1]);
  const rot = await meta(t, "/out/t.png");
  assert.deepEqual([rot.width, rot.height], [20, 60]);
  const c = await meta(t, "/out/c.png");
  assert.deepEqual([c.width, c.height], [10, 5]);
  const th = await meta(t, "/out/th.gif");
  assert.deepEqual([th.width, th.height, th.pages], [16, 16, 1]);
});

// ====================================================================== SVG

test("an SVG is claimed, described, and rasterized at the size you ask for", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/logo.svg", svg());

  const out = await t.script<{ info: ImageSummary; natural: string; twice: string; dpi: string }>(
    `import { describe, convert } from 'env:images';
     export default async function main() {
       return {
         info: await describe('/inbox/logo.svg'),
         natural: await convert('/inbox/logo.svg', '/out/natural.png'),
         twice: await convert('/inbox/logo.svg', '/out/2x.png', { scale: 2 }),
         dpi: await convert('/inbox/logo.svg', '/out/print.png', { density: 288 }),
       };
     }`,
  );
  assert.equal(out.info.format, "svg");
  assert.deepEqual([out.info.width, out.info.height], [100, 50]);
  const natural = await meta(t, "/out/natural.png");
  assert.deepEqual([natural.width, natural.height], [100, 50]);
  const twice = await meta(t, "/out/2x.png");
  assert.deepEqual([twice.width, twice.height], [200, 100], "scale 2 renders at twice natural size");
  const dpi = await meta(t, "/out/print.png");
  assert.deepEqual([dpi.width, dpi.height], [400, 200], "288 DPI is four times the natural 72");

  // Not just the right dimensions — the vector actually drew something.
  const px = await sharp(Buffer.from(await t.fs.readBytes("/out/2x.png"))).raw().toBuffer({ resolveWithObject: true });
  const centre = (px.info.height / 2) * px.info.width + px.info.width / 2;
  assert.ok(px.data[centre * px.info.channels + 2] > 150, "the circle rendered blue at the centre");
});

test("resize renders a vector AT the target size instead of blowing up a small raster", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/logo.svg", svg());
  await t.script(
    `import { resize } from 'env:images';
     export default async function main() { return resize('/inbox/logo.svg', '/out/big.png', { width: 800 }); }`,
  );
  const m = await meta(t, "/out/big.png");
  assert.equal(m.width, 800);
  // A rasterize-then-upscale would leave a soft edge; rendering at 800 keeps it
  // hard, so the transition row has few intermediate values.
  const raw = await sharp(Buffer.from(await t.fs.readBytes("/out/big.png"))).raw().toBuffer({ resolveWithObject: true });
  const row = (m.height ?? 0) >> 1;
  let soft = 0;
  for (let x = 0; x < (m.width ?? 0); x++) {
    const b = raw.data[(row * raw.info.width + x) * raw.info.channels + 2];
    if (b > 40 && b < 160) soft++;
  }
  assert.ok(soft < 12, `an edge rendered at full size should be crisp, found ${soft} half-lit pixels`);
});

test("writing an SVG is refused, because sharp cannot encode one", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid());
  const run = await t.runScript(
    `import { convert } from 'env:images';
     export default async function main() { return convert('/inbox/a.png', '/out/a.svg'); }`,
  );
  assert.equal(run.ok, false);
  assert.match(run.error ?? "", /SVG is read-only here/);
  assert.match(run.error ?? "", /Write \.png or \.webp instead/);
  assert.equal(await t.fs.exists("/out/a.svg"), false);
});

test("scale and density are checked before libvips is asked for something absurd", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/logo.svg", svg());
  for (const [opts, pattern] of [
    ["{ scale: 0 }", /scale must be a positive multiplier/],
    ["{ scale: 1000 }", /up to 100/],
    ["{ density: -5 }", /density must be a DPI between 1 and 7200/],
  ] as const) {
    const run = await t.runScript(
      `import { convert } from 'env:images';
       export default async function main() { return convert('/inbox/logo.svg', '/out/x.png', ${opts}); }`,
    );
    assert.equal(run.ok, false, opts);
    assert.match(run.error ?? "", pattern);
  }
});

// ===================================================================== text

/** The brightest pixel anywhere in the image — did anything get drawn? */
async function brightest(t: AdapterTestEnv, path: string): Promise<number> {
  const s = await sharp(Buffer.from(await t.fs.readBytes(path))).stats();
  return Math.max(...s.channels.slice(0, 3).map((c) => c.max));
}

test("text draws onto an image", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/dark.png",
    await solid({ width: 300, height: 120, colour: { r: 0, g: 0, b: 0, alpha: 1 } }),
  );
  assert.equal(await brightest(t, "/inbox/dark.png"), 0, "the base is black to begin with");

  const out = await t.script<string>(
    `import { text } from 'env:images';
     export default async function main() {
       return text('/inbox/dark.png', '/out/titled.png', { text: 'DRAFT', size: 40, colour: '#ffffff' });
     }`,
  );
  assert.equal(out, "/out/titled.png");
  const m = await meta(t, "/out/titled.png");
  assert.deepEqual([m.width, m.height], [300, 120], "the base keeps its size");
  assert.ok(await brightest(t, "/out/titled.png") > 200, "white text should leave white pixels");
});

test("text lands where gravity says, and on every frame of an animation", async () => {
  const t = await env();
  await t.fs.writeFile(
    "/inbox/dark.png",
    await solid({ width: 300, height: 120, colour: { r: 0, g: 0, b: 0, alpha: 1 } }),
  );
  await t.script(
    `import { text } from 'env:images';
     export default async function main() {
       await text('/inbox/dark.png', '/out/nw.png', { text: 'X', size: 40, gravity: 'northwest' });
     }`,
  );
  const raw = await sharp(Buffer.from(await t.fs.readBytes("/out/nw.png"))).raw().toBuffer({ resolveWithObject: true });
  const brightestIn = (x0: number, y0: number, x1: number, y1: number) => {
    let max = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) max = Math.max(max, raw.data[(y * raw.info.width + x) * raw.info.channels]);
    }
    return max;
  };
  assert.ok(brightestIn(0, 0, 150, 60) > 200, "northwest means the top-left quadrant");
  assert.equal(brightestIn(150, 60, 300, 120), 0, "and nothing in the opposite one");

  await t.fs.writeFile("/inbox/loop.gif", await animatedGif(3, 120, 60));
  await t.script(
    `import { text } from 'env:images';
     export default async function main() {
       return text('/inbox/loop.gif', '/out/marked.gif', { text: 'HI', size: 24, gravity: 'centre' });
     }`,
  );
  const bytes = Buffer.from(await t.fs.readBytes("/out/marked.gif"));
  const m = await sharp(bytes, { animated: true }).metadata();
  assert.equal(m.pages, 3, "captioning must not cost the animation");
  const frames = await sharp(bytes, { animated: true }).raw().toBuffer({ resolveWithObject: true });
  for (let page = 0; page < 3; page++) {
    let max = 0;
    for (let y = page * (m.pageHeight ?? 0); y < (page + 1) * (m.pageHeight ?? 0); y++) {
      for (let x = 0; x < frames.info.width; x++) {
        max = Math.max(max, frames.data[(y * frames.info.width + x) * frames.info.channels + 1]);
      }
    }
    assert.ok(max > 180, `frame ${page} should carry the caption, brightest green was ${max}`);
  }
});

test("text is text, not markup", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/dark.png", await solid({ width: 400, height: 100, colour: { r: 0, g: 0, b: 0, alpha: 1 } }));
  await t.script(
    `import { text } from 'env:images';
     export default async function main() {
       return text('/inbox/dark.png', '/out/quoted.png', { text: '<b>a & "b"</b>', size: 24 });
     }`,
  );
  assert.ok(await brightest(t, "/out/quoted.png") > 200, "angle brackets must draw, not break the document");
});

test("text refuses an empty string and an invented gravity", async () => {
  const t = await env();
  await t.fs.writeFile("/inbox/a.png", await solid({ width: 100, height: 100 }));
  for (const [opts, pattern] of [
    ["{ text: '   ' }", /needs a \{ text \} string/],
    ["{ text: 'hi', gravity: 'up-a-bit' }", /is not one of north, northeast/],
    ["{ text: 'hi', size: -4 }", /size must be a positive number/],
  ] as const) {
    const run = await t.runScript(
      `import { text } from 'env:images';
       export default async function main() { return text('/inbox/a.png', '/out/x.png', ${opts}); }`,
    );
    assert.equal(run.ok, false, opts);
    assert.match(run.error ?? "", pattern);
  }
});

test("a batch pass over many files is one run, not one per file", async () => {
  const t = await env();
  for (let i = 0; i < 12; i++) {
    await t.fs.writeFile(`/inbox/batch/p${i}.png`, await solid({ width: i < 6 ? 500 : 50, height: 100 }));
  }
  const out = await t.script<{ resized: number; skipped: number }>(
    `import { glob } from 'env:fs';
     import { describe, resize } from 'env:images';
     export default async function main(args) {
       const paths = await glob('/inbox/batch/*.png');
       let resized = 0, skipped = 0;
       for (const path of paths) {
         const meta = await describe(path);
         if (meta.width <= args.maxWidth) { skipped++; continue; }
         await resize(path, '/out/' + path.split('/').pop().replace('.png', '.webp'),
                      { width: args.maxWidth, fit: 'inside' });
         resized++;
       }
       return { resized, skipped };
     }`,
    { maxWidth: 200 },
  );
  assert.deepEqual(out, { resized: 6, skipped: 6 });
  const produced = await t.fs.glob("/out/*.webp");
  assert.equal(produced.length, 6);
  assert.equal((await meta(t, produced[0])).width, 200);
});
