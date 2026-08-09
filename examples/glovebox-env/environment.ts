/**
 * The working environment this glovebox ships.
 *
 * Three stdlib adapters, chosen because between them they touch every kind of
 * thing a bundler gets wrong:
 *
 * - `env:documents` is ordinary JavaScript with ordinary npm dependencies
 *   (docx, pdf-lib) — the easy case.
 * - `env:render` resolves pdf.js's font directory through
 *   `require.resolve("pdfjs-dist/package.json")` and shells out to LibreOffice.
 * - `env:motion` derives its own package root from `import.meta.url` to find
 *   the React and Babel it ships with, bundles a scene with esbuild's native
 *   binary, screenshots it in Chromium, and encodes with ffmpeg.
 *
 * And underneath all three, `glove-working-environment` itself starts every
 * script in a worker thread it opens by URL. None of that survives being
 * inlined into one file, which is what `glovebox build` used to do.
 */
import { documents } from "glove-env-documents";
import { motion, MOTION_LIMITS } from "glove-env-motion";
import { render } from "glove-env-render";
import { createWorkingEnvironment, type WorkingEnvironment } from "glove-working-environment";

/**
 * A render is a browser launch plus a screenshot per frame, so the default
 * 30-second script budget is nowhere near enough — `env:motion` refuses the
 * call up front rather than being killed halfway through it.
 */
export const LIMITS = {
  ...MOTION_LIMITS,
  // A few seconds of 1280x720 video is comfortably over the 32MB default.
  maxFileBytes: 128 * 1024 * 1024,
  maxVfsBytes: 512 * 1024 * 1024,
};

export async function buildEnvironment(): Promise<WorkingEnvironment> {
  return createWorkingEnvironment({
    limits: LIMITS,
    stdlib: [documents(), render(), motion()],
  });
}
