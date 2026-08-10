/**
 * What a render costs, and how many browsers exist while it happens — the
 * evidence behind #123.
 *
 * Two measurements, because the issue is two problems:
 *
 *   1. **Reuse.** Three stills of the same scene in one environment. If the
 *      browser is relaunched per render they cost the same; if it is kept,
 *      the first pays the launch and the rest do not.
 *   2. **Fleet.** Four environments rendering at once. The number that
 *      matters is not the wall clock, it is how many Chromium processes were
 *      alive at the peak — that is the one a multi-tenant host runs out of
 *      memory on.
 *
 * The browser count is sampled from /proc rather than from our own
 * bookkeeping, so it stays honest across the change: it counts real processes
 * either way, including on the revision that has no bookkeeping to ask.
 *
 * Run: `pnpm --filter glove-env-motion bench`
 */
import { readdir, readFile } from "node:fs/promises";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { motion, MOTION_LIMITS, resolveBrowser } from "../src/index";

const SCENE = `
import { useFrame, useVideoConfig, interpolate } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { width, height } = useVideoConfig();
  const x = interpolate(frame, [0, 29], [0, 200]);
  return (
    <div style={{ width, height, background: '#0b0b10' }}>
      <div style={{
        position: 'absolute', top: 40, left: 10,
        width: 60, height: 60, background: '#7c5cff',
        transform: 'translateX(' + x + 'px)',
      }} />
    </div>
  );
}
`;

const RESOLVE_FROM = new URL("..", import.meta.url).pathname;

/**
 * Chromium *browser* processes running right now.
 *
 * A browser spawns renderers, a GPU process and a zygote, all sharing the
 * executable path; only the browser process lacks `--type=`. Counting those is
 * counting browsers.
 */
async function browserProcesses(exe: string): Promise<number> {
  if (process.platform !== "linux") return -1;
  let n = 0;
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
      if (cmd[0] !== exe) continue;
      if (cmd.some((a) => a.startsWith("--type="))) continue;
      n++;
    } catch {
      /* the process went away while we were looking at it */
    }
  }
  return n;
}

/** Poll the process table while `body` runs; report the high-water mark. */
async function withPeak<T>(exe: string, body: () => Promise<T>): Promise<{ result: T; peak: number }> {
  let peak = 0;
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      peak = Math.max(peak, await browserProcesses(exe));
      await new Promise((r) => setTimeout(r, 25));
    }
  })();
  try {
    return { result: await body(), peak };
  } finally {
    stop = true;
    await sampler;
  }
}

async function envWith() {
  return createAdapterTestEnv(motion({ resolveFrom: RESOLVE_FROM }), { limits: MOTION_LIMITS });
}

const still = (out: string) =>
  `import { still } from 'env:motion';
   export default async function main() {
     return still('/scenes/a.jsx', '${out}', { frame: 8, width: 320, height: 180 });
   }`;

async function main(): Promise<void> {
  const exe = await resolveBrowser();
  if (!exe) {
    console.log("no Chromium on this host — nothing to measure. Set GLOVE_CHROMIUM_PATH.");
    return;
  }

  // ---- 1. reuse within one environment ------------------------------------
  {
    const t = await envWith();
    await t.env.fs.writeFile("/scenes/a.jsx", SCENE);
    const times: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now();
      await t.script(still(`/out/s${i}.png`));
      times.push(performance.now() - t0);
    }
    await t.env.close();
    console.log(
      `reuse   render 1 ${times[0].toFixed(0)}ms   render 2 ${times[1].toFixed(0)}ms   render 3 ${times[2].toFixed(0)}ms` +
        `   (2+3 mean ${(((times[1] + times[2]) / 2)).toFixed(0)}ms, ${(times[0] / ((times[1] + times[2]) / 2)).toFixed(2)}× render 1)`,
    );
  }

  // ---- 2. four environments rendering at once ------------------------------
  {
    const envs = await Promise.all([envWith(), envWith(), envWith(), envWith()]);
    for (const t of envs) await t.env.fs.writeFile("/scenes/a.jsx", SCENE);

    const t0 = performance.now();
    const { peak } = await withPeak(exe, async () => {
      await Promise.all(envs.map((t, i) => t.script(still(`/out/c${i}.png`))));
    });
    const wall = performance.now() - t0;
    for (const t of envs) await t.env.close();

    console.log(`fleet   4 environments rendering at once: ${wall.toFixed(0)}ms wall, peak ${peak} Chromium processes`);
  }

  // Give back whatever is still held, so the benchmark exits promptly. Absent
  // on the revision that has no pool, which is the point of the catch.
  const pool = await import("../src/browser-pool").catch(() => null);
  await pool?.closeMotionBrowsers();
}

await main();
