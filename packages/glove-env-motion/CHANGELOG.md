# glove-env-motion

## 1.0.0

### Minor Changes

- [#78](https://github.com/porkytheblack/glove/pull/78) [`b0a1e0b`](https://github.com/porkytheblack/glove/commit/b0a1e0b2d60f83de85c3a21790a6b0f4124712b3) Thanks [@porkytheblack](https://github.com/porkytheblack)! - `env:motion` — React scenes to video, GIF, frames and stills

  **Exploratory.** The renderer works and is measured; the API may still move.

  A new stdlib adapter. The agent writes a React component; a video, an animated GIF, PNG frames or a still image comes out.

  ```js
  import { render, still } from "env:motion";

  await render("/scenes/intro.jsx", "/out/intro.mp4", {
    durationSeconds: 4,
    mode: "frame",
  });
  await still("/scenes/card.jsx", "/out/card.png", {
    width: 1200,
    height: 630,
  });
  ```

  The environment could already produce a PDF, a deck, a workbook and a resized image. It could not produce anything that _moves_ — and the reason was never the encoder, since ffmpeg has been there since `glove-env-media`. It was that nothing could draw a frame.

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

  ### Zero-config by construction

  The five silent-failure findings above are not host configuration. `@babel/core@^7`, the presets, React and ffmpeg are **dependencies** — the host's Babel (any version, or none) never enters the picture, and a bare server with no React of its own still renders `useFrame()` scenes after nothing but `pnpm add glove-env-motion` plus a Chromium. The Reanimated path is one install (`react-native-reanimated react-native-web`) with the worklets transform applied automatically; a missing install fails at bundle time with the command to run, not with still frames.

  The `mode` switch is gone as a requirement: the renderer drives **both** the frame number and the clock every frame, so `useFrame()` and Reanimated scenes animate with no configuration, and a still of a clock-driven scene now captures the animated moment instead of the initial state (frame-driven stills are jumped to directly; clock-driven ones are walked without intermediate screenshots).

  Renders that cannot fit the environment's script budget are **refused up front** with the exact `limits: { runTimeoutMs: … }` line to add (`MOTION_LIMITS` exports a good default) instead of dying mid-run. `glove-motion-doctor` checks a host in one command — browser, ffmpeg, react, reanimated — with the one-line fix on every failure, and the generated `/std/motion/README.md` carries an "On this host" section so the agent knows what is available before spending a render.

  ### Cross-platform by default

  Nothing in discovery assumes Linux. The browser is found in order: `GLOVE_CHROMIUM_PATH` / `CHROME_PATH`, a `PLAYWRIGHT_BROWSERS_PATH` layout (linux, mac and win subpaths), playwright's own registry, then the **system Chrome / Edge / Chromium** in each OS's standard locations — so a macOS or Windows laptop with a browser installed needs no browser install at all. ffmpeg resolves explicit-first (`ffmpegPath`, then `GLOVE_FFMPEG_PATH` / `FFMPEG_PATH`), then the bundled `@ffmpeg-installer` build, then a `ffmpeg` on PATH for the platform/arch pairs the installer does not ship; the failure message names the platform's own install command (brew / winget / apt). The per-platform candidate lists are exported and platform-parameterized, so Linux CI pins the macOS and Windows behavior too.

  ### Cost

  Every frame is a browser screenshot, roughly a second per 10 frames. There is a hard ceiling per render (default 1800 frames), and passing it is refused with the number and the reason rather than timing out deep into the run. A host mounting this must raise `limits.runTimeoutMs` — the 30s default is nowhere near a render.

### Patch Changes

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`da6b249`](https://github.com/porkytheblack/glove/commit/da6b249a2c217f32a8add39d6e238ae4f4bc2e2e), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860)]:
  - glove-working-environment@0.2.0
