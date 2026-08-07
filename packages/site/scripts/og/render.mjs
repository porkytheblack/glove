/**
 * Renders public/og.png from og.html.
 *
 * The card is drawn in a real browser rather than composed in a raster
 * tool, so it uses the site's own fonts (DM Sans, JetBrains Mono) and CSS
 * effects — glow, masks, blend modes — exactly as the site does. It is
 * shot at 2× and downscaled with Lanczos, which is what keeps the hairline
 * grid and the dashed trajectories from crawling.
 *
 * Not wired into the site build: this runs by hand when the card changes,
 * and its two dependencies are deliberately NOT devDependencies of
 * glove-site (they would be installed on every Vercel build for a script
 * that runs once a year). Run it from a workspace package that already has
 * them — glove-env-motion has playwright-core, glove-image has sharp:
 *
 *   cp packages/site/scripts/og/render.mjs packages/glove-env-motion/r.mjs
 *   pnpm --filter glove-env-motion exec node r.mjs
 *   rm packages/glove-env-motion/r.mjs
 *
 * The glyph paths in og.html are copied verbatim from
 * components/glove-logo.tsx — re-copy them if the mark ever changes.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const html = resolve(here, "og.html");
const out = resolve(here, "../../public/og.png");
const tmp = resolve(here, "og-2x.tmp.png");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`file://${html}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// Fail loudly rather than shipping a card set in a fallback font.
const fontsLoaded = await page.evaluate(
  () =>
    document.fonts.check('500 104px "DM Sans"') &&
    document.fonts.check('500 14px "JetBrains Mono"'),
);
if (!fontsLoaded) throw new Error("Brand fonts did not load — check network access to Google Fonts.");
if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);

await page.waitForTimeout(500);
await page.screenshot({ path: tmp });
await browser.close();

await sharp(tmp)
  .resize(1200, 630, { kernel: "lanczos3" })
  .png({ compressionLevel: 9 })
  .toFile(out);

const { size } = await sharp(out).metadata().then(async (m) => ({
  size: (await import("node:fs")).statSync(out).size,
  ...m,
}));
await (await import("node:fs/promises")).unlink(tmp);

console.log(`wrote ${out} — 1200x630, ${(size / 1024).toFixed(0)}KB`);
