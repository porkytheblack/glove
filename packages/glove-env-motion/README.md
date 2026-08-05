# glove-env-motion

**Status: exploratory.** The renderer works and is measured; the API may still move.

A stdlib adapter for [`glove-working-environment`](../glove-working-environment). The agent writes a React component; a video, an animated GIF, PNG frames or a still image comes out.

## The whole setup

```bash
pnpm add glove-env-motion
npx playwright-core install chromium        # the one real requirement
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { motion, MOTION_LIMITS } from "glove-env-motion";

const env = await createWorkingEnvironment({
  stdlib: [motion()],
  limits: MOTION_LIMITS,   // renders need more than the 30s default script budget
});
```

That is all of it. React, the Babel toolchain, and ffmpeg **ship with the package**; the browser is the only thing a host installs. Want React Native / Reanimated scenes too?

```bash
pnpm add react-native-reanimated react-native-web
```

No Babel config, no bundler config, no plugin wiring — the package carries its own pinned toolchain and applies the worklets transform when Reanimated is present.

Check any host in one command:

```
$ pnpm exec glove-motion-doctor
✓ browser     /opt/browsers/chromium/chrome
✓ ffmpeg      …/@ffmpeg-installer/linux-x64/ffmpeg
✓ react       bundled with glove-env-motion — no install needed
✓ reanimated  installed with react-native-web and the worklets plugin — React Native motion code renders here

ready — env:motion can render on this host
```

Every failing line comes with the one command that fixes it. The same checks feed `capabilities()` (what the agent can call at runtime) and the generated `/std/motion/README.md` (which tells the agent what *this* host can do before it spends a render finding out).

And if you forget `MOTION_LIMITS`? The render is **refused up front** with the exact `limits: { runTimeoutMs: … }` line to add — it does not die mid-run with a generic timeout.

## What the agent does

```js
import { render, still } from 'env:motion';

export default async function main() {
  await render('/scenes/intro.jsx', '/out/intro.mp4', { durationSeconds: 4 });
  await still('/scenes/card.jsx', '/out/card.png', { width: 1200, height: 630 });
}
```

The output extension picks the format: `.mp4`, `.webm`, `.gif`, `.png`, or an extensionless path for a directory of numbered frames.

Stills are the part people underestimate. A one-frame render is a PNG, so the same component that makes a video makes a chart, a title card, a diagram or a social image — with the whole browser as the drawing surface. That is why this is `env:motion` and not `env:video`.

## Why this exists

The environment could already produce a PDF, a deck, a workbook and a resized image. It could not produce anything that *moves* — and the reason was never the encoder, because ffmpeg has been there since `glove-env-media`. It was that nothing could draw a frame.

## The one hard problem

A browser animation is a function of wall-clock time. Screenshot the same scene twice and you get two different pictures; a renderer that fell behind by 4ms emits a frame from the wrong moment. Neither is acceptable for video, where frame N must be exactly N.

So time is **replaced**, not measured. Before any scene code runs, `requestAnimationFrame` becomes a queue nobody drains except the renderer, and `performance.now()` / `Date.now()` return a number it sets. One advance is one frame.

**Measured:** two independent runs of the same 60-frame scene produce byte-identical PNGs for every frame. That is what makes a re-render after an edit a real diff, and it is the property everything else here is built on.

## Two ways to write a scene — no mode switch

### `useFrame()` — a pure function of the frame number

```jsx
import { useFrame, useVideoConfig, interpolate, Easing } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { fps, width } = useVideoConfig();
  const x = interpolate(frame, [0, fps * 2], [0, 400], { easing: Easing.inOut });
  return (
    <div style={{ width, height: 720, background: '#0b0b10', display: 'grid', placeItems: 'center' }}>
      <h1 style={{ color: 'white', transform: `translateX(${x}px)` }}>Q3 Revenue</h1>
    </div>
  );
}
```

### Reanimated — real React Native motion code, unchanged

```jsx
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

export default function Scene() {
  const x = useSharedValue(0);
  useEffect(() => { x.value = withTiming(600, { duration: 2000 }); }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Animated.View style={[{ width: 160, height: 160, backgroundColor: '#7c5cff' }, style]} />;
}
```

The renderer drives **both signals on every frame** — the frame number for `useFrame()` scenes, the clock for Reanimated — and each signal is inert for the other kind, so any scene animates with no configuration and the two stay consistent by construction (frame *f* is always *t = f/fps*). Earlier versions made the caller pick a `mode`, and picking wrong produced a valid video of a still image; `mode` still exists as an override, but nobody has to know that.

Stills got the same treatment: a frame-driven scene is detected and **jumped** to the requested frame directly, a clock-driven scene is walked there without intermediate screenshots — so spot-checking frame 90 is cheap for either kind, and a Reanimated still captures the animated moment rather than the initial state.

## Five findings, all internalised

These cost a diagnostic round each. Every one fails *silently* — first frame renders, nothing moves, no error, nothing to grep for — which is exactly why none of them is host configuration anymore:

| Finding | Where it lives now |
|---|---|
| Reanimated's worklets are lifted by a **Babel** plugin, and esbuild does not run Babel | The transform runs automatically whenever Reanimated is installed |
| The plugin requires **Babel 7**, and a host's Babel 8 fails inside it with a misleading error | `@babel/core@^7` is a *dependency* — the host's Babel never enters the picture |
| `.web.js` must beat `.js`, or the **native** runtime bundles and does nothing in a browser | Resolution order is fixed internally |
| The synthetic clock must install **before** the scene's module code runs | Init order is fixed internally |
| `page.setContent()` does not run `addInitScript` — only **navigation** does | The page is written to disk and navigated to |

The one silent case that can still occur — Reanimated present but its plugin missing, e.g. a broken partial install — is detected and reported as a render warning naming the reinstall.

## Checking the output

`render()` returns `warnings`, and an empty array is the good case. The one that matters most says **every frame came out identical** — the scene is not animating, and the video is technically valid and completely useless. That is exactly the failure a test of the individual pieces would miss.

Then look at it. Pair with `env:render`'s `view_image`:

```js
const out = await render('/scenes/intro.jsx', '/out/intro.mp4', { keepFrames: '/tmp/frames' });
if (out.warnings.length) throw new Error(out.warnings.join('; '));
```

```
view_image({ path: '/tmp/frames/frame-00045.png',
             prompt: 'Is the heading fully inside the frame, and readable against the background?' })
```

## Cost

Every frame is a browser screenshot — roughly a second per 10 frames. A 10-second clip at 30fps is 300 frames. Three guards, in order: a hard frame ceiling per render (default 1800, refused with the number), the up-front budget check against the environment's `runTimeoutMs` (refused with the fix), and the docs steering agents to iterate on stills before rendering the whole thing.

## Output formats

| Output path | Result |
|---|---|
| `…/x.mp4` | H.264, `yuv420p`, `+faststart`, padded to even dimensions |
| `…/x.webm` | VP9 |
| `…/x.gif` | Palette generated across the whole sequence, then applied — one-pass quantisation shimmers |
| `…/x.png` | A single frame |
| `…/frames` (no extension) | A directory of `frame-00000.png` … |

## Known limits

- **No audio.** Add it with `env:media` — that package owns ffmpeg for the agent, and this one deliberately stops at "frames to a playable file".
- **Frames render in sequence, in one browser.** A `useFrame()` scene is a pure function of the frame and could be split across workers; nothing does that yet.
- **Only system fonts.** The browser has no webfont unless the scene embeds one.
