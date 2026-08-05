---
"glove-env-motion": minor
---

`env:motion` — React scenes to video, GIF, frames and stills

**Exploratory.** The renderer works and is measured; the API may still move.

A new stdlib adapter. The agent writes a React component; a video, an animated GIF, PNG frames or a still image comes out.

```js
import { render, still } from 'env:motion';

await render('/scenes/intro.jsx', '/out/intro.mp4', { durationSeconds: 4, mode: 'frame' });
await still('/scenes/card.jsx', '/out/card.png', { width: 1200, height: 630 });
```

The environment could already produce a PDF, a deck, a workbook and a resized image. It could not produce anything that *moves* — and the reason was never the encoder, since ffmpeg has been there since `glove-env-media`. It was that nothing could draw a frame.

Stills are the underrated half. A one-frame render is a PNG, so the same component that makes a video makes a chart, a title card, a diagram or a social image, with the whole browser as the drawing surface. Hence `env:motion`, not `env:video`.

### Determinism is the load-bearing property

A browser animation is a function of wall-clock time: screenshot the same scene twice and you get two different pictures, and a renderer that falls behind by 4ms emits a frame from the wrong moment. So time is **replaced** rather than measured — before any scene code runs, `requestAnimationFrame` becomes a queue nobody drains except the renderer, and `performance.now()` / `Date.now()` return a number it sets. One advance is one frame.

Measured: two independent runs of the same 60-frame scene produce byte-identical PNGs for every frame. That is what makes a re-render after an edit a real diff.

### Two ways to write a scene

`useFrame()` is a pure function of the frame number, so any frame renders on its own — an agent can check frame 90 without rendering the 89 before it, which is what makes iteration cheap.

**Reanimated also works, unchanged** — the same React Native motion code a phone runs, with `react-native` aliased to `react-native-web` and the clock advanced frame by frame.

Four things have to be true for that, and **every one of them fails silently** — first frame renders, nothing moves, no error, nothing to grep for:

- the worklets **Babel** plugin must run (Reanimated's whole model is worklets, and esbuild does not run Babel — without it `useAnimatedStyle(() => …)` is an ordinary closure nothing calls)
- Babel must be **7**, not 8 (the plugin's own preset calls `api.assertVersion(7)`, and under 8 the failure names the wrong cause)
- `.web.js` must beat `.js` in resolution, or the **native** runtime gets bundled and does nothing in a browser
- the clock must be installed **before** the bundle, or a scene captures the real `requestAnimationFrame` and escapes control

The adapter checks all four and says what it found. `capabilities()` reports whether a browser and Reanimated exist before a render is spent finding out. Reanimated and Babel are **optional** peers — a host rendering only `useFrame()` scenes needs neither.

### Checking the work

`render()` returns `warnings`, and an empty array is the good case. The one that matters most says every frame came out identical: the scene is not animating, and the video is technically valid and useless. Pair `keepFrames` with `view_image` to catch the rest — text off the edge and white-on-white are invisible in code and obvious in a picture.

### Cost

Every frame is a browser screenshot, roughly a second per 10 frames. There is a hard ceiling per render (default 1800 frames), and passing it is refused with the number and the reason rather than timing out deep into the run. A host mounting this must raise `limits.runTimeoutMs` — the 30s default is nowhere near a render.
