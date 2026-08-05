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
import { test } from "node:test";
import { createAdapterTestEnv } from "glove-working-environment/testing";
import { motion, resolveBrowser } from "../src/index";

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
    limits: { runTimeoutMs: 240_000 },
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
  const { runScript, env } = await createAdapterTestEnv(motion({ maxFrames: 10 }), { limits: { runTimeoutMs: 240_000 } });
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
