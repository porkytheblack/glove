# glove-env-motion

**Status: exploratory.** The renderer works and is measured; the API may still move.

A stdlib adapter for [`glove-working-environment`](../glove-working-environment). The agent writes a React component; a video, an animated GIF, PNG frames or a still image comes out.

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { motion } from "glove-env-motion";

const env = await createWorkingEnvironment({
  stdlib: [motion()],
  // A render is a browser launch plus one screenshot per frame. The 30s
  // default script budget is nowhere near enough.
  limits: { runTimeoutMs: 240_000 },
});
```

```js
import { render, still } from 'env:motion';

export default async function main() {
  await render('/scenes/intro.jsx', '/out/intro.mp4', { durationSeconds: 4, mode: 'frame' });
  await still('/scenes/card.jsx', '/out/card.png', { width: 1200, height: 630 });
}
```

## Why this exists

The environment could already produce a PDF, a deck, a workbook and a resized image. It could not produce anything that *moves* — and the reason was never the encoder, because ffmpeg has been there since `glove-env-media`. It was that nothing could draw a frame.

Stills are the part people underestimate. A one-frame render is a PNG, so the same component that makes a video makes a chart, a title card, a diagram or a social image — with the whole browser as the drawing surface. That is why this is `env:motion` and not `env:video`.

## The one hard problem

A browser animation is a function of wall-clock time. Screenshot the same scene twice and you get two different pictures; a renderer that fell behind by 4ms emits a frame from the wrong moment. Neither is acceptable for video, where frame N must be exactly N.

So time is **replaced**, not measured. Before any scene code runs, `requestAnimationFrame` becomes a queue nobody drains except the renderer, and `performance.now()` / `Date.now()` return a number it sets. One `advance(ms)` is one frame.

**Measured:** two independent runs of the same 60-frame scene produce byte-identical PNGs for every frame. That is what makes a re-render after an edit a real diff, and it is the property everything else here is built on.

## Two ways to write a scene

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

Render with `mode: 'frame'`. Any frame can be produced on its own, so an agent can check frame 90 without rendering the 89 before it — which is what makes iteration cheap. **Prefer this.**

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

Runs under the default `mode: 'clock'`. This is the same code a phone runs — `react-native` is aliased to `react-native-web`, and the renderer advances the clock frame by frame, so a two-second `withTiming` is exactly two seconds of video.

## Four things that have to be true for Reanimated, all of which fail silently

Each of these produces a scene that renders its first frame and never moves — **no error, no warning, nothing to grep for.** They cost a diagnostic round each, so they are worth writing down.

| | Why |
|---|---|
| **The worklets Babel plugin must run** | Reanimated's model is worklets: functions lifted out of the module and driven by its own runtime. That lifting is a Babel transform, and esbuild does not run Babel. Without it, `useAnimatedStyle(() => …)` is an ordinary closure nothing ever calls. |
| **Babel must be 7, not 8** | The plugin's own preset calls `api.assertVersion(7)`. Under Babel 8 the build fails with a message about the wrong `@babel/core` being loaded, several layers from the cause. |
| **`.web.js` must beat `.js` in resolution** | React Native ships platform variants. Resolve wrong and the **native** runtime gets bundled, which does nothing at all in a browser — silently. |
| **The clock must be installed before the bundle** | A scene that captures the real `requestAnimationFrame` at module scope escapes the renderer entirely. |

The adapter checks for all four and reports what it found. `capabilities()` says whether Reanimated is available at all, before a render is spent finding out:

```js
const caps = await capabilities();   // { browser, canRender, reanimated, maxFrames, formats }
```

Reanimated is an **optional** peer. A host that only renders `useFrame()` scenes needs neither it nor Babel.

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

Text off the edge and white-on-white are invisible in code and obvious in the picture.

## Cost

Every frame is a browser screenshot — roughly a second per 10 frames. A 10-second clip at 30fps is 300 frames. There is a hard ceiling per render (default 1800 frames, a minute at 30fps); passing it is refused with the number and the reason rather than timing out at frame 4000.

This is why the docs push stills first: most things that need a picture do not need a video.

## Requirements

- **Chromium.** Auto-detected from `GLOVE_CHROMIUM_PATH`, `CHROME_PATH`, `PLAYWRIGHT_BROWSERS_PATH`, or playwright's own registry. `npx playwright install chromium` if you have none.
- **ffmpeg**, bundled via `@ffmpeg-installer/ffmpeg` — only needed for video and GIF, not for stills or frames.
- **react** and **react-dom**, resolved from `resolveFrom` (default: the host's cwd).
- Optionally **react-native-web**, **react-native-reanimated**, **@babel/core@^7** and **@babel/preset-react**, for the Reanimated path.

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
- **`mode` is a real choice.** A `useFrame()` scene rendered under `clock` — or a Reanimated scene under `frame` — produces identical frames. The warning catches it, but it costs a render.
