/**
 * Does this image actually work?
 *
 * `GLOVEBOX_SELFCHECK=1` makes the wrap module run this instead of starting
 * the server, so the answer comes from `docker run` against the real artifact
 * — same bundle, same node_modules, same base image — rather than from reading
 * the build config.
 *
 * It exists because every failure this deployment story has is invisible until
 * something runs:
 *
 * | check      | what breaks without it                                    |
 * |------------|-----------------------------------------------------------|
 * | worker     | the hub inlined into the bundle: no `executor/worker.js`   |
 * | documents  | a vendored adapter whose npm deps were never installed     |
 * | render     | no LibreOffice, or pdf.js/@napi-rs/canvas built for macOS  |
 * | motion     | no Chromium, or esbuild's binary missing from the bundle   |
 * | video      | no ffmpeg for the platform the image actually runs on      |
 *
 * None of them is a build error. All of them are a run error, and four of the
 * five only appear inside the container.
 */
import { buildEnvironment } from "./environment";
import type { RunResult, WorkingEnvironment } from "glove-working-environment";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

const SCENE = `import { useFrame, useVideoConfig, interpolate, Easing } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { fps, width, height } = useVideoConfig();
  const y = interpolate(frame, [0, fps], [40, 0], { easing: Easing.out });
  const opacity = interpolate(frame, [0, Math.max(1, fps * 0.5)], [0, 1]);
  return (
    <div style={{ width, height, background: '#0b0b10', display: 'grid', placeItems: 'center' }}>
      <h1 style={{ color: '#fff', font: '600 42px system-ui', transform: \`translateY(\${y}px)\`, opacity }}>
        glovebox-env
      </h1>
    </div>
  );
}
`;

const SCRIPTS: Record<string, string> = {
  // Nothing but env:fs and a return value. If this runs, the hub found its
  // worker entry — which is the whole P0.
  "/scripts/hello.js": `/**
 * Prove the sandbox executes: write a file, read it back, return the length.
 */
import { writeFile, readFile } from 'env:fs';

export default async function main() {
  await writeFile('/tmp/hello.txt', 'the environment is alive');
  const back = await readFile('/tmp/hello.txt');
  return { length: back.length, text: back };
}
`,
  "/scripts/make-docx.js": `/**
 * Compose a Word document with env:documents.
 */
import { docx } from 'env:documents';

export default async function main() {
  await docx.create('/out/report.docx', {
    title: 'Glovebox environment selfcheck',
    content: [
      { heading: 'It works' },
      { text: 'This document was composed inside the sandbox by a script.' },
      { table: { headers: ['adapter', 'needs'], rows: [['render', 'LibreOffice'], ['motion', 'Chromium']] } },
    ],
  });
  return await docx.describe('/out/report.docx');
}
`,
  "/scripts/rasterize.js": `/**
 * Rasterize the Word document to a page PNG with env:render.
 */
import { render } from 'env:render';

export default async function main() {
  return await render('/out/report.docx', '/out/pages', { pages: [1], maxWidth: 900 });
}
`,
  "/scripts/still.js": `/**
 * One frame of a React scene, rendered in a real browser by env:motion.
 */
import { still } from 'env:motion';

export default async function main() {
  return await still('/scenes/intro.jsx', '/out/frame.png', { frame: 6, width: 480, height: 270, fps: 12 });
}
`,
  "/scripts/video.js": `/**
 * The same scene as an MP4 — frames through ffmpeg.
 */
import { render } from 'env:motion';

export default async function main() {
  return await render('/scenes/intro.jsx', '/out/intro.mp4', {
    durationInFrames: 12,
    fps: 12,
    width: 480,
    height: 270,
  });
}
`,
};

function summarize(result: RunResult): string {
  if (!result.ok) return result.error ?? "failed with no error text";
  const value = result.result;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `${(text ?? "undefined").slice(0, 220)} (${result.durationMs}ms)`;
}

async function timed(name: string, fn: () => Promise<string>): Promise<Check> {
  const started = Date.now();
  try {
    return { name, ok: true, detail: await fn(), ms: Date.now() - started };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? (e.stack ?? e.message) : String(e), ms: Date.now() - started };
  }
}

async function runOne(env: WorkingEnvironment, path: string): Promise<string> {
  const result = await env.runScript(path);
  if (!result.ok) throw new Error(summarize(result));
  return summarize(result);
}

export async function selfcheck(): Promise<Check[]> {
  const checks: Check[] = [];
  let env: WorkingEnvironment | undefined;

  checks.push(
    await timed("environment", async () => {
      env = await buildEnvironment();
      // A write to /scripts is validated by LOADING the module in a worker, so
      // this line alone is what used to throw "could not find the script
      // worker entry".
      for (const [path, source] of Object.entries(SCRIPTS)) await env.fs.writeFile(path, source);
      await env.fs.mkdir("/scenes");
      await env.fs.writeFile("/scenes/intro.jsx", SCENE);
      return `modules: ${[...env.moduleDescriptions.keys()].join(", ")}`;
    }),
  );

  if (env) {
    const e = env;
    checks.push(await timed("worker", () => runOne(e, "/scripts/hello.js")));
    checks.push(await timed("documents", () => runOne(e, "/scripts/make-docx.js")));
    checks.push(await timed("render (LibreOffice + pdf.js)", () => runOne(e, "/scripts/rasterize.js")));
    checks.push(await timed("motion still (Chromium)", () => runOne(e, "/scripts/still.js")));
    checks.push(await timed("motion video (ffmpeg)", () => runOne(e, "/scripts/video.js")));
    await e.close();
  }

  return checks;
}

/** Run the checks, print a report, and exit with 0 or 1. Never returns. */
export async function runSelfcheckAndExit(): Promise<never> {
  const checks = await selfcheck();
  const failed = checks.filter((c) => !c.ok);
  process.stdout.write("\nglovebox-env selfcheck\n");
  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(30)} ${c.ms}ms\n`);
    process.stdout.write(`        ${c.detail.replace(/\n/g, "\n        ")}\n`);
  }
  process.stdout.write(
    `\n${checks.length - failed.length}/${checks.length} checks passed\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}
