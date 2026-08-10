/**
 * `env:motion` end to end.
 *
 * These render for real: a browser opens, frames are screenshotted, ffmpeg
 * encodes. That is slow and it is the point — the failure this adapter invites
 * is a render that "succeeds" and produces a video of a still image, which no
 * amount of unit testing the pieces would catch.
 *
 * Every render test skips with a message when no Chromium is present, rather
 * than passing quietly. A green suite that never rendered anything is worse
 * than a red one.
 */
import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import {
  browserFleetCap,
  browserFleetStats,
  closeMotionBrowsers,
  doctor,
  limitBrowserFleet,
  motion,
  MOTION_LIMITS,
  resolveBrowser,
  resolveFfmpegSync,
  systemBrowserCandidates,
  BrowserFleetError,
  PW_BROWSER_SUBPATHS,
} from "../src/index";

// Browsers now outlive a single render on purpose, so the suite hands them
// back at the end rather than sitting out the idle timer.
after(closeMotionBrowsers);

const HAVE_BROWSER = (await resolveBrowser()) !== null;
const skip = HAVE_BROWSER ? false : "no Chromium available — set GLOVE_CHROMIUM_PATH or run `npx playwright install chromium`";

/** Frame-driven: a pure function of the frame number. */
const FRAME_SCENE = `
import { useFrame, useVideoConfig, interpolate } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { width, height } = useVideoConfig();
  const x = interpolate(frame, [0, 29], [0, 600]);
  return (
    <div style={{ width, height, background: '#0b0b10' }}>
      <div style={{
        position: 'absolute', top: 200, left: 40,
        width: 160, height: 160, background: '#7c5cff',
        transform: 'translateX(' + x + 'px)',
      }} />
    </div>
  );
}
`;

/** Clock-driven: real React Native Reanimated code. */
const REANIMATED_SCENE = `
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';

export default function Scene() {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withTiming(600, { duration: 1000, easing: Easing.inOut(Easing.cubic) });
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={{ width: 640, height: 360, backgroundColor: '#0b0b10' }}>
      <Animated.View style={[{ width: 80, height: 80, backgroundColor: '#7c5cff' }, style]} />
    </View>
  );
}
`;

/**
 * A render is a browser launch plus one screenshot per frame, which blows
 * straight through the environment's 30s default script budget. Any host
 * mounting this adapter has to raise `runTimeoutMs` the same way.
 */
async function envWith() {
  return createAdapterTestEnv(motion({ resolveFrom: new URL("..", import.meta.url).pathname }), {
    limits: MOTION_LIMITS,
  });
}

test("capabilities reports what this host can do before a render is spent", async () => {
  const { script, env } = await envWith();
  try {
    const caps = await script<{ canRender: boolean; browser: string | null; reanimated: boolean; maxFrames: number }>(
      `import { capabilities } from 'env:motion';
       export default async function main() { return capabilities(); }`,
    );
    assert.equal(typeof caps.canRender, "boolean");
    assert.equal(caps.canRender, HAVE_BROWSER, "canRender must agree with whether a browser actually exists");
    assert.equal(caps.reanimated, true, "this package devDepends on reanimated + react-native-web");
    assert.ok(caps.maxFrames > 0);

    // The generated docs carry the same facts, so the agent learns what this
    // host can do from /std before spending a render finding out.
    const docs = await env.fs.readFile("/std/motion/README.md");
    assert.match(docs, /## On this host/);
    assert.match(docs, HAVE_BROWSER ? /Browser: available/ : /Browser: \*\*none found\*\*/);
    assert.match(docs, /Reanimated: available/);
  } finally {
    await env.close();
  }
});

test("a scene path that does not exist fails by name, before launching anything", async () => {
  const { runScript, env } = await envWith();
  try {
    const r = await runScript(
      `import { render } from 'env:motion';
       export default async function main() { return render('/scenes/nope.jsx', '/out/x.mp4'); }`,
    );
    assert.equal(r.ok, false);
    assert.match(String(r.error), /no such scene: \/scenes\/nope\.jsx/);
  } finally {
    await env.close();
  }
});

test("a frame count past the ceiling is refused with the limit and the reason", async () => {
  const { runScript, env } = await createAdapterTestEnv(motion({ maxFrames: 10 }), { limits: MOTION_LIMITS });
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    const r = await runScript(
      `import { render } from 'env:motion';
       export default async function main() {
         return render('/scenes/a.jsx', '/out/a.mp4', { durationInFrames: 500 });
       }`,
    );
    assert.equal(r.ok, false);
    assert.match(String(r.error), /500 frames exceeds the 10-frame limit/);
    assert.match(String(r.error), /each frame is a full browser screenshot/);
  } finally {
    await env.close();
  }
});

test("a scene with a syntax error fails with the location, not a browser timeout", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/broken.jsx", `export default function Scene() { return <div>unclosed }`);
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/broken.jsx', '/out/x.png'); }`,
    );
    assert.equal(r.ok, false);
    assert.match(String(r.error), /broken\.jsx/, "the error should name the file the agent wrote");
  } finally {
    await env.close();
  }
});

/**
 * A scene that throws is dead the moment it throws.
 *
 * This used to wait out the whole mount timeout — measured at 188s against the
 * 180s default — and then report only "the scene never mounted", while the
 * browser's own error sat one line below in a field the caller was free to
 * ignore. An agent retried it five times. The cost of a typo was a quarter of
 * an hour.
 */
test("a scene that throws fails immediately, carrying the browser's own error", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    await env.fs.writeFile(
      "/scenes/throws.jsx",
      `export default function Scene() { throw new Error('boom in the scene'); }`,
    );
    const started = Date.now();
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/throws.jsx', '/out/x.png'); }`,
    );
    const elapsed = Date.now() - started;

    assert.equal(r.ok, false);
    assert.match(String(r.error), /boom in the scene/, "the scene's own error must survive to the caller");
    assert.match(String(r.error), /threw while rendering/, "and be named as the scene's fault, not the renderer's");
    assert.ok(elapsed < 30_000, `should fail on the error, not the timeout — took ${elapsed}ms`);
  } finally {
    await env.close();
  }
});

test("an easing that does not exist says so, and lists the ones that do", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    await env.fs.writeFile(
      "/scenes/easing.jsx",
      `import { useFrame, interpolate, Easing } from 'glove/motion';
       export default function Scene() {
         return <div style={{ opacity: interpolate(useFrame(), [0, 30], [0, 1], { easing: Easing.elastic }) }} />;
       }`,
    );
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/easing.jsx', '/out/x.png'); }`,
    );
    assert.equal(r.ok, false);
    assert.match(String(r.error), /Easing\.elastic does not exist/);
    assert.match(String(r.error), /bezier/, "the message should list what is available");
  } finally {
    await env.close();
  }
});

test("the easings a scene is likely to reach for all exist and are usable", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    // Names borrowed from muscle memory elsewhere must not crash the render.
    await env.fs.writeFile(
      "/scenes/eases.jsx",
      `import { useFrame, interpolate, Easing } from 'glove/motion';
       const NAMES = ['linear','in','out','inOut','ease','easeIn','easeOut','easeInOut','quad','cubic','sin','expo','circle','back','bounce'];
       export default function Scene() {
         const f = useFrame();
         const xs = NAMES.map((n) => interpolate(f, [0, 30], [0, 100], { easing: Easing[n] }));
         const b = interpolate(f, [0, 30], [0, 100], { easing: Easing.bezier(0.4, 0, 0.2, 1) });
         return <div style={{ width: 200, height: 60, background: '#111' }}>{xs.length + b}</div>;
       }`,
    );
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/eases.jsx', '/out/eases.png'); }`,
    );
    assert.equal(r.ok, true, String(r.error));
  } finally {
    await env.close();
  }
});

/**
 * The scene's pictures live in the tree, not next to the scene.
 *
 * `/inbox/bag.webp` is the most obvious thing to put in a video — an upload —
 * and the page is a `file://` URL, so an absolute src resolved against the
 * real filesystem root and found nothing. The render succeeded, the file was
 * valid, and the product was an empty box. Nothing said so.
 */
test("an image referenced by VFS path from anywhere in the tree renders", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    // A 1×1 PNG is enough: the assertion is that the browser decoded something.
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await env.mount(new Uint8Array(pixel), "/inbox/bag.webp");
    await env.fs.writeFile(
      "/scenes/shot.jsx",
      `export default function Scene() {
         return <div style={{ width: 200, height: 80, background: '#111' }}><img src="/inbox/bag.webp" width="60" /></div>;
       }`,
    );
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/shot.jsx', '/out/shot.png', { frame: 0 }); }`,
    );
    assert.equal(r.ok, true, String(r.error));
    const warnings = (r.result as { warnings: string[] }).warnings;
    assert.deepEqual(warnings, [], `the image should load, got warnings: ${warnings.join(" / ")}`);
  } finally {
    await env.close();
  }
});

test("an image the tree does not have is a warning, not a silent empty box", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    await env.fs.writeFile(
      "/scenes/gone.jsx",
      `export default function Scene() { return <div><img src="/inbox/nope.png" /></div>; }`,
    );
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/gone.jsx', '/out/gone.png', { frame: 0 }); }`,
    );
    assert.equal(r.ok, true, String(r.error));
    const warnings = (r.result as { warnings: string[] }).warnings;
    assert.ok(
      warnings.some((w) => w.includes("/inbox/nope.png")),
      `a missing image must be named in the warnings, got: ${JSON.stringify(warnings)}`,
    );
  } finally {
    await env.close();
  }
});

test("a frame index sent as a string is accepted, and a real one is rejected by type", { skip }, async () => {
  const { runScript, env } = await envWith();
  try {
    await env.fs.writeFile(
      "/scenes/plain.jsx",
      `export default function Scene() { return <div style={{ width: 100, height: 40, background: '#333' }} />; }`,
    );
    // Script args are JSON a model wrote: "3" and 3 are the same intent.
    const coerced = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/plain.jsx', '/out/a.png', { frame: '3' }); }`,
    );
    assert.equal(coerced.ok, true, String(coerced.error));

    const rejected = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/plain.jsx', '/out/b.png', { frame: 'later' }); }`,
    );
    assert.equal(rejected.ok, false);
    // The old message printed a bare value, so a type error read as a value
    // error against a rule the printed value satisfied.
    assert.match(String(rejected.error), /"later" \(string\)/);
  } finally {
    await env.close();
  }
});

test("a frame-driven scene renders a still at an exact frame", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    const out = await script<{ path: string; frames: number; warnings: string[] }>(
      `import { still } from 'env:motion';
       export default async function main() {
         return still('/scenes/a.jsx', '/out/frame15.png', { frame: 15, width: 640, height: 360 });
       }`,
    );
    assert.equal(out.frames, 1);
    assert.deepEqual(out.warnings, [], "a clean render should warn about nothing");

    const bytes = await env.fs.readBytes("/out/frame15.png");
    assert.ok(bytes.byteLength > 100);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "must actually be a PNG");
  } finally {
    await env.close();
  }
});

test("two stills at different frames differ — the scene is a function of the frame", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    for (const frame of [0, 25]) {
      await script(
        `import { still } from 'env:motion';
         export default async function main(args) {
           return still('/scenes/a.jsx', '/out/f' + args.frame + '.png', { frame: args.frame, width: 640, height: 360 });
         }`,
        { frame },
      );
    }
    const a = await env.fs.readBytes("/out/f0.png");
    const b = await env.fs.readBytes("/out/f25.png");
    assert.notEqual(Buffer.from(a).toString("base64"), Buffer.from(b).toString("base64"), "frame 0 and frame 25 must not be the same picture");
  } finally {
    await env.close();
  }
});

test("the same scene renders byte-identically twice — renders are deterministic", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    for (const n of [1, 2]) {
      await script(
        `import { still } from 'env:motion';
         export default async function main(args) {
           return still('/scenes/a.jsx', '/out/run' + args.n + '.png', { frame: 12, width: 640, height: 360 });
         }`,
        { n },
      );
    }
    const one = Buffer.from(await env.fs.readBytes("/out/run1.png"));
    const two = Buffer.from(await env.fs.readBytes("/out/run2.png"));
    assert.ok(one.equals(two), "determinism is what makes a re-render after an edit a real diff");
  } finally {
    await env.close();
  }
});

test("a frame-driven scene renders to a playable mp4", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    const out = await script<{ frames: number; bytes: number; durationSeconds: number; warnings: string[] }>(
      `import { render } from 'env:motion';
       export default async function main() {
         return render('/scenes/a.jsx', '/out/a.mp4',
                       { durationInFrames: 20, fps: 20, width: 640, height: 360, mode: 'frame' });
       }`,
    );
    assert.equal(out.frames, 20);
    assert.equal(out.durationSeconds, 1);
    assert.ok(out.bytes > 0);
    assert.deepEqual(out.warnings, [], `unexpected warnings: ${out.warnings.join("; ")}`);

    const bytes = await env.fs.readBytes("/out/a.mp4");
    // ftyp box at offset 4 — a real MP4 container, not an empty file.
    assert.equal(Buffer.from(bytes.subarray(4, 8)).toString("ascii"), "ftyp");
  } finally {
    await env.close();
  }
});

test("a Reanimated scene actually animates under the synthetic clock", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/r.jsx", REANIMATED_SCENE);
    const out = await script<{ frames: number; warnings: string[] }>(
      `import { render } from 'env:motion';
       export default async function main() {
         return render('/scenes/r.jsx', '/tmp/frames',
                       { durationInFrames: 12, fps: 12, width: 640, height: 360 });
       }`,
    );
    assert.equal(out.frames, 12);
    // The warning that matters: identical frames mean the worklet plugin did
    // not run and withTiming never ticked.
    assert.deepEqual(out.warnings, [], `Reanimated did not animate: ${out.warnings.join("; ")}`);

    const first = Buffer.from(await env.fs.readBytes("/tmp/frames/frame-00000.png"));
    const last = Buffer.from(await env.fs.readBytes("/tmp/frames/frame-00011.png"));
    assert.ok(!first.equals(last), "withTiming must have moved the box between the first and last frame");
  } finally {
    await env.close();
  }
});

test("a static scene is reported as a warning rather than passing as a video", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile(
      "/scenes/static.jsx",
      `export default function Scene() {
         return <div style={{ width: 320, height: 180, background: '#222' }} />;
       }`,
    );
    const out = await script<{ warnings: string[] }>(
      `import { render } from 'env:motion';
       export default async function main() {
         return render('/scenes/static.jsx', '/out/s.mp4',
                       { durationInFrames: 6, fps: 6, width: 320, height: 180 });
       }`,
    );
    assert.equal(out.warnings.length, 1, "a video of a still image is valid and almost never intended");
    assert.match(out.warnings[0], /every frame is identical/);
  } finally {
    await env.close();
  }
});

test("a scene importing a sibling file resolves it", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/theme.js", `export const accent = '#ff5c7c';`);
    await env.fs.writeFile(
      "/scenes/uses-theme.jsx",
      `import { accent } from './theme.js';
       import { useFrame } from 'glove/motion';
       export default function Scene() {
         const f = useFrame();
         return <div style={{ width: 320, height: 180, background: accent, opacity: (f + 1) / 10 }} />;
       }`,
    );
    const out = await script<{ warnings: string[] }>(
      `import { still } from 'env:motion';
       export default async function main() {
         return still('/scenes/uses-theme.jsx', '/out/t.png', { frame: 3, width: 320, height: 180 });
       }`,
    );
    assert.deepEqual(out.warnings, []);
    assert.ok((await env.fs.readBytes("/out/t.png")).byteLength > 100);
  } finally {
    await env.close();
  }
});


test("a useFrame scene animates with zero configuration — no mode required", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    const out = await script<{ frames: number; warnings: string[] }>(
      `import { render } from 'env:motion';
       export default async function main() {
         return render('/scenes/a.jsx', '/tmp/auto', { durationInFrames: 6, fps: 6, width: 640, height: 360 });
       }`,
    );
    assert.equal(out.frames, 6);
    assert.deepEqual(out.warnings, [], "auto mode must not report the scene as static");
    const first = Buffer.from(await env.fs.readBytes("/tmp/auto/frame-00000.png"));
    const last = Buffer.from(await env.fs.readBytes("/tmp/auto/frame-00005.png"));
    assert.ok(!first.equals(last), "the box must have moved with nobody choosing a mode");
  } finally {
    await env.close();
  }
});

test("a still of a clock-driven scene captures the moment, not the initial state", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/r.jsx", REANIMATED_SCENE);
    for (const frame of [0, 10]) {
      await script(
        `import { still } from 'env:motion';
         export default async function main(args) {
           return still('/scenes/r.jsx', '/out/r' + args.frame + '.png', { frame: args.frame, fps: 12, width: 640, height: 360 });
         }`,
        { frame },
      );
    }
    const start = Buffer.from(await env.fs.readBytes("/out/r0.png"));
    const later = Buffer.from(await env.fs.readBytes("/out/r10.png"));
    // Before auto mode, still() forced frame-driving and a Reanimated still
    // was always the initial state — this is the regression that would bring
    // that bug back.
    assert.ok(!start.equals(later), "frame 10 of a withTiming scene must differ from frame 0");
  } finally {
    await env.close();
  }
});

test("a render that cannot fit the time it can be granted is refused with the exact fix", async () => {
  // Deliberately the DEFAULT environment limits — the misconfiguration every
  // new host starts with.
  const { runScript, env } = await createAdapterTestEnv(motion());
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    const r = await runScript(
      `import { render } from 'env:motion';
       export default async function main() {
         return render('/scenes/a.jsx', '/out/a.mp4', { durationInFrames: 90 });
       }`,
    );
    assert.equal(r.ok, false);
    // A script asks for time per run; the environment limit is the ceiling
    // that bounds the ask. Both have to be in the message, because with the
    // default limits both are in the way.
    assert.match(String(r.error), /timeout_ms: \d+/, "the error must name the per-run timeout to ask for");
    assert.match(String(r.error), /run_script/);
    assert.match(String(r.error), /limits\.runTimeoutMs/, "and the ceiling that clamps it");
    assert.match(String(r.error), /limits: \{ runTimeoutMs: \d+ \}/, "including the exact line that raises the ceiling");
    assert.match(String(r.error), /MOTION_LIMITS/);
  } finally {
    await env.close();
  }
});

// ------------------------------------------------------------- browser fleet
//
// A render used to launch and close a Chromium around every call, and N
// environments in one process meant N Chromiums with nothing counting them.
// Measured on this host: a warm still went 770ms → 437ms once the browser is
// kept, and four environments rendering at once went from a peak of 4-6
// Chromium processes to exactly the cap.
//
// The property that must not move is determinism. Everything else in this
// package is built on the same scene producing the same bytes, so the first
// test here renders one frame on a browser that has just launched and on one
// that has already rendered, and compares them.

test("a second render reuses the browser, and the pixels do not change", { skip }, async () => {
  const { script, env } = await envWith();
  try {
    await env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    const shoot = (n: number) =>
      script(
        `import { still } from 'env:motion';
         export default async function main(args) {
           return still('/scenes/a.jsx', '/out/r' + args.n + '.png', { frame: 12, width: 320, height: 180 });
         }`,
        { n },
      );

    // Cold: this environment has no browser yet.
    await closeMotionBrowsers();
    const before = browserFleetStats().launches;
    await shoot(1);
    const afterFirst = browserFleetStats().launches;
    assert.equal(afterFirst, before + 1, "the first render in an environment launches one browser");

    // Warm: the same environment, the same browser.
    await shoot(2);
    await shoot(3);
    assert.equal(
      browserFleetStats().launches,
      afterFirst,
      "renders 2 and 3 must reuse the browser render 1 launched, not launch their own",
    );

    const cold = Buffer.from(await env.fs.readBytes("/out/r1.png"));
    const warm = Buffer.from(await env.fs.readBytes("/out/r2.png"));
    const warmer = Buffer.from(await env.fs.readBytes("/out/r3.png"));
    assert.ok(cold.equals(warm), "a reused browser must produce the same bytes as a freshly launched one");
    assert.ok(warm.equals(warmer), "and keep producing them");
  } finally {
    await env.close();
  }
});

test("concurrent renders across environments are bounded by the fleet cap", { skip }, async () => {
  const cap = browserFleetCap();
  const envs = await Promise.all([envWith(), envWith(), envWith(), envWith()]);
  try {
    for (const t of envs) await t.env.fs.writeFile("/scenes/a.jsx", FRAME_SCENE);
    // Start from a known floor: peakOpen is process-wide and earlier tests
    // have been using it.
    await closeMotionBrowsers();
    const { resetBrowserFleetCounters } = await import("../src/browser-pool");
    resetBrowserFleetCounters();

    const outs = await Promise.all(
      envs.map((t, i) =>
        t.script<{ frames: number }>(
          `import { still } from 'env:motion';
           export default async function main(args) {
             return still('/scenes/a.jsx', '/out/c' + args.i + '.png', { frame: 4, width: 320, height: 180 });
           }`,
          { i },
        ),
      ),
    );

    for (const out of outs) assert.equal(out.frames, 1, "every environment must still get its render");
    assert.ok(
      browserFleetStats().peakOpen <= cap,
      `four environments rendering at once opened ${browserFleetStats().peakOpen} browsers, over the cap of ${cap}`,
    );
    assert.ok(browserFleetStats().launches >= cap, "and it did use the whole cap rather than serialising on one");
  } finally {
    for (const t of envs) await t.env.close();
  }
});

test("a render that fails gives its permit back", { skip }, async () => {
  // The deadlock this guards against: a permit held by a render that threw is
  // never returned, and every other environment in the process waits forever.
  // A short timeout keeps the failure cheap — the scene never mounts, so the
  // render can only end by running out of time.
  const { runScript, env } = await createAdapterTestEnv(
    motion({ resolveFrom: new URL("..", import.meta.url).pathname, timeoutMs: 2500 }),
    { limits: MOTION_LIMITS },
  );
  try {
    await env.fs.writeFile(
      "/scenes/throws.jsx",
      `export default function Scene() { throw new Error('scene exploded'); }`,
    );
    const r = await runScript(
      `import { still } from 'env:motion';
       export default async function main() { return still('/scenes/throws.jsx', '/out/x.png'); }`,
    );
    assert.equal(r.ok, false, "a scene that throws on render must fail the render");
    assert.equal(browserFleetStats().inUse, 0, "the failed render must not still be holding a browser");
  } finally {
    await env.close();
  }
});

test("the fleet cap only ever goes down, and refuses a nonsense value", () => {
  // The cap is one number shared by every environment in the process. When two
  // adapters disagree the smaller has to win, or one careless mount raises the
  // ceiling for everybody else on the box.
  const cap = browserFleetCap();
  limitBrowserFleet(cap + 5);
  assert.equal(browserFleetCap(), cap, "a larger value must not raise the cap");
  assert.throws(() => limitBrowserFleet(0), BrowserFleetError);
  assert.throws(() => limitBrowserFleet(1.5), BrowserFleetError);
  assert.equal(browserFleetCap(), cap, "a rejected value must not have changed anything");
});


test("browser discovery is not a Linux assumption — every platform has candidates", () => {
  // The lists are platform-parameterized precisely so this can be pinned from
  // any OS: a regression that drops macOS or Windows fails here on Linux CI.
  assert.ok(
    systemBrowserCandidates("darwin").some((p) => p.includes("Google Chrome.app")),
    "macOS must look in /Applications",
  );
  assert.ok(
    systemBrowserCandidates("win32", { PROGRAMFILES: "C:\\Program Files" }).some((p) => p.endsWith("chrome.exe")),
    "Windows must look for chrome.exe under Program Files",
  );
  assert.ok(
    systemBrowserCandidates("win32", { PROGRAMFILES: "C:\\Program Files" }).some((p) => p.endsWith("msedge.exe")),
    "Edge is a Chromium and ships with Windows — a host with only Edge must still render",
  );
  assert.ok(
    systemBrowserCandidates("linux").some((p) => p === "/usr/bin/chromium"),
    "Linux must look in /usr/bin",
  );

  for (const layout of ["chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
    assert.ok(PW_BROWSER_SUBPATHS.includes(layout), `the playwright scan must know ${layout}`);
  }
});

test("ffmpeg resolution is explicit-first and falls back beyond the bundled binary", () => {
  // On this host the bundled installer exists, so it wins when nothing is named.
  const bundled = resolveFfmpegSync();
  assert.ok(bundled, "the bundled @ffmpeg-installer must resolve here");
  assert.equal(bundled!.source, "bundled");

  // An explicit answer is always obeyed, without existence-checking a path
  // the host deliberately chose.
  assert.deepEqual(resolveFfmpegSync("/custom/ffmpeg"), { path: "/custom/ffmpeg", source: "option" });

  // The env override is honoured when it points at something real.
  const real = bundled!.path;
  assert.deepEqual(resolveFfmpegSync(undefined, { GLOVE_FFMPEG_PATH: real }), { path: real, source: "env" });
});

test("doctor names every requirement, and every failure carries its fix", async () => {
  const report = await doctor({ resolveFrom: new URL("..", import.meta.url).pathname });
  const byName = new Map(report.checks.map((c) => [c.name, c]));
  for (const name of ["browser", "ffmpeg", "react", "reanimated"]) {
    assert.ok(byName.has(name), `doctor must check ${name}`);
  }
  assert.equal(byName.get("browser")!.ok, HAVE_BROWSER, "doctor must agree with reality about the browser");
  assert.equal(byName.get("react")!.ok, true, "react ships with the package, so it can only fail on a broken install");
  assert.equal(byName.get("reanimated")!.ok, true);
  for (const check of report.checks.filter((c) => !c.ok)) {
    assert.ok(check.fix, `the failing check "${check.name}" must name its fix`);
  }
});

test("types and bindings agree in both directions", async () => {
  const { audit, env } = await envWith();
  try {
    const report = await audit();
    assert.deepEqual(report.errors, [], report.errors.join("\n"));
    assert.deepEqual([...report.bindings].sort(), ["capabilities", "render", "still"]);
  } finally {
    await env.close();
  }
});
