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

/** Read an output back host-side, so assertions do not depend on the adapter. */
async function meta(t: AdapterTestEnv, path: string) {
  return sharp(Buffer.from(await t.fs.readBytes(path))).metadata();
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
