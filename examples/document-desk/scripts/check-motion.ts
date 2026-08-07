/**
 * Does this machine render video?
 *
 * `pnpm check:motion` — the render path the desk mounts, exercised end to end
 * with no model, no API key and no browser tab. It answers the question you
 * actually have before starting the app: is the toolchain here, and does a
 * scene come out the other side as a playable file.
 *
 * A render is the one capability in this example that depends on something
 * outside the repo — a browser — so it is also the one worth checking before
 * you spend a conversation on it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkingEnvironment } from "glove-working-environment";
import { MOTION_LIMITS, doctor, motion } from "glove-env-motion";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "check-output");

/** A scene that moves, so a still frame is visibly the wrong answer. */
const SCENE = `import { useFrame, useVideoConfig, interpolate, Easing } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { fps, width, height } = useVideoConfig();
  const value = Math.round(interpolate(frame, [0, fps * 2], [0, 4_200_000], { easing: Easing.inOut }));
  const lift = interpolate(frame, [0, fps * 0.6], [24, 0], { easing: Easing.out });
  return (
    <div style={{ width, height, background: '#0b0b10', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', transform: \`translateY(\${lift}px)\` }}>
        <div style={{ color: '#8b8b9a', fontSize: 18, letterSpacing: 4, textTransform: 'uppercase' }}>Q3 revenue</div>
        <div style={{ color: 'white', fontSize: 92, fontWeight: 700 }}>{'$' + value.toLocaleString('en-US')}</div>
      </div>
    </div>
  );
}
`;

/** Exactly what the agent writes: a script, against the injected module. */
const SCRIPT = `import { render, still } from 'env:motion';

/** Render the revenue counter to an mp4, plus one frame as a PNG. */
export default async function main() {
  const video = await render('/scenes/revenue.jsx', '/out/revenue.mp4', {
    durationSeconds: 3, fps: 30, width: 960, height: 540,
  });
  const frame = await still('/scenes/revenue.jsx', '/out/revenue-frame60.png', {
    frame: 60, fps: 30, width: 960, height: 540,
  });
  return { video, frame };
}
`;

type Verb = { name: string; do: (input: unknown) => Promise<{ status: string; data?: unknown; message?: string }> };

const report = await doctor();
for (const check of report.checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.name.padEnd(11)} ${check.detail}`);
  if (!check.ok && check.fix) console.log(`  ↳ ${check.fix}`);
}
console.log();
if (!report.ok) {
  console.error("Cannot render on this host — fix the lines above and run again.");
  process.exit(1);
}

const presented: Array<{ name: string; mediaType: string; bytes: number }> = [];

const env = await createWorkingEnvironment({
  stdlib: [motion()],
  // The same pairing the desk uses. Drop the limits and the render is refused
  // before it starts rather than timing out halfway.
  limits: { ...MOTION_LIMITS },
  onPresent: ({ name, mediaType, bytes }) => void presented.push({ name, mediaType, bytes: bytes.byteLength }),
  execution: { size: 1 },
});

const verb = (name: string) => env.tools.find((t) => t.name === name) as unknown as Verb;

try {
  for (const [path, content] of [
    ["/scenes/revenue.jsx", SCENE],
    ["/scripts/render-revenue.js", SCRIPT],
  ] as const) {
    const written = await verb("write_file").do({ path, content });
    if (written.status !== "success") throw new Error(`${path}: ${written.message}`);
  }

  const started = Date.now();
  const run = await verb("run_script").do({ path: "/scripts/render-revenue.js" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status !== "success") {
    console.error(`render failed after ${seconds}s:\n${run.message}`);
    process.exit(1);
  }
  console.log(`rendered in ${seconds}s`);
  console.log(String(run.data));

  // Hand both over the way the agent would, and check the labels: a video the
  // browser is told is application/octet-stream is a video nobody watches.
  for (const [path, caption] of [
    ["/out/revenue.mp4", "Q3 revenue counting up from zero."],
    ["/out/revenue-frame60.png", "Frame 60, as a still."],
  ] as const) {
    const gift = await verb("present").do({ path, caption });
    if (gift.status !== "success") throw new Error(`present ${path}: ${gift.message}`);
  }

  await mkdir(OUT, { recursive: true });
  for (const item of presented) {
    const bytes = await env.fs.readBytes(`/out/${item.name}`);
    await writeFile(join(OUT, item.name), bytes);
    console.log(`${item.name.padEnd(22)} ${item.mediaType.padEnd(10)} ${(item.bytes / 1024).toFixed(0)} KB`);
  }

  const video = presented.find((p) => p.name.endsWith(".mp4"));
  if (video?.mediaType !== "video/mp4") {
    console.error(`\nthe mp4 was handed over as ${video?.mediaType} — the browser will download it instead of playing it`);
    process.exit(1);
  }

  console.log(`\nopen ${join(OUT, "revenue.mp4")} — the number should count up.`);
} finally {
  await env.close();
}
