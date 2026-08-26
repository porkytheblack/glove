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

- [#131](https://github.com/porkytheblack/glove/pull/131) [`416d1dd`](https://github.com/porkytheblack/glove/commit/416d1ddb992e6b82119f9eef78c8af7dfe96014e) Thanks [@claude](https://github.com/apps/claude)! - Adapters accept a range of hub versions instead of pinning one exactly

  Every `glove-env-*` declared its `glove-working-environment` peer as `workspace:*`, which pnpm rewrites to an **exact** version at publish time. The published packages had already diverged because of it — `glove-env-documents@0.1.0` required exactly `0.1.0` while `glove-env-motion@0.1.0` required exactly `0.2.0`, so installing both from npm was unsatisfiable, and every future hub release orphaned every adapter already out there.

  The peer is now `workspace:^`, which publishes as a caret range (`^0.2.0`). Verified against a real `pnpm pack` tarball rather than assumed from the source manifest.

- [#96](https://github.com/porkytheblack/glove/pull/96) [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a) Thanks [@porkytheblack](https://github.com/porkytheblack)! - Scenes can use images from anywhere in the tree, and say so when they cannot

  `<img src="/inbox/bag.webp" />` — an uploaded photo, the most obvious thing to put in a video — rendered as an empty box. The page is a `file://` URL, so an absolute src resolved against the real filesystem root and found nothing. Only assets sitting _beside_ the scene were staged. The render succeeded, the file was valid, the warnings array was empty, and the missing product was visible only by looking at the frame.

  Assets named by absolute VFS path are now staged next to the page and the reference rewritten to reach them, so any path in the tree works. A path that is not in the tree becomes a warning naming it, and — as a backstop for anything path rewriting cannot see — the renderer asks the page which images it failed to decode and warns for each. A picture that did not load can no longer pass silently.

  **`still` accepts a frame index sent as a string.** Script arguments are JSON a model wrote, where `"78"` and `78` are the same intent. Rejecting the string was defensible; reporting it as `got 78` was not — the message then stated a rule the printed value satisfied, which reads as a broken validator. It now coerces, and a genuine mistake reports the type: `got "later" (string)`.

  **`interpolate` checks its easing.** `Easing.out(Easing.cubic)` is the shape other libraries use; here it evaluates a curve _at_ a function, yields `NaN`, and surfaced as `easing is not a function` thrown from inside the runtime — naming neither the scene nor the option. It now says which option was wrong and what the right form is.

- [#131](https://github.com/porkytheblack/glove/pull/131) [`9eac7d5`](https://github.com/porkytheblack/glove/commit/9eac7d58c6c9a8361d553371d3b7f1e104078f33) Thanks [@claude](https://github.com/apps/claude)! - Keep the browser between renders, and cap how many exist at once.

  `env:motion` launched a Chromium and closed it around **every** render. And because each environment did that on its own, N agents rendering at the same time meant N concurrent browsers, each with `--no-sandbox`, with nothing anywhere counting them — `maxFrames` bounds one render, not the fleet. That is the multi-tenant failure in the issue: several sessions rendering at once spawn a browser per render per environment and exhaust memory.

  Both halves are fixed, and both are measured (`pnpm --filter glove-env-motion bench`, 3 runs each, 320×180 stills on a host with a real Chromium):

  ```
                           before          after
  warm still (renders 2,3)  770ms          437ms      1.76× faster
  first render in an env   ~1310ms        ~1255ms      unchanged — it still launches
  4 envs rendering at once  peak 4-6       peak 2      Chromium processes
  ```

  A browser is now kept per adapter instance — one environment, one Chromium, never shared between tenants — and closed after 30s idle or when another environment needs its slot. The number of browsers is capped process-wide at 2 by default, configurable with `motion({ maxBrowsers })` or `GLOVE_MOTION_MAX_BROWSERS`, and reported by `capabilities().maxBrowsers`. Because the fleet is one shared resource, the setting is a floor: when two adapters disagree the smaller wins, so one careless mount cannot raise the ceiling for everything else on the box.

  Isolation is unchanged, and this is the part that had to be proved rather than argued. A render gets a fresh browser **context** — empty storage, no cookies, no leftover page state — so what it reuses is the process, not the session. Determinism is what everything else in this package is built on, so there is a test that renders the same frame on a browser that has just launched and on one that has already rendered, and asserts the two PNGs are byte-identical.

  The deadlock a process-wide semaphore invites is guarded three ways: a lease is released in a `finally`, so a render that throws still gives it up (asserted by a test that fails a render and checks nothing is still held); a browser nobody is using is closed to make room rather than waited on, so idle environments cannot block a busy one; and a wait has a deadline, after which the caller gets an error naming the cap instead of hanging. `closeMotionBrowsers()` is exported for host shutdown.

  Also updates the up-front budget refusal for the new per-run timeout. It used to tell the agent to raise `limits.runTimeoutMs`, which hands the whole allowance to every script including an accidental `for(;;)`; it now names the `timeout_ms` to pass on the `run_script` call, with the environment ceiling as the thing that bounds it. `MOTION_LIMITS`, the generated `/std/motion/README.md`, the skill and the package README say the same thing. The 20s head on the estimate is deliberately kept: the first render in an environment still pays a cold launch, and being wrong high refuses a render the agent can see, where being wrong low kills one at frame 400.

  Test-suite wall clock is unchanged — 22 tests in 30.8s against 18 in 38.2s — because the renders that share an environment now share its browser, which pays for the four new tests.

- [#96](https://github.com/porkytheblack/glove/pull/96) [`f73d7af`](https://github.com/porkytheblack/glove/commit/f73d7af5a1639808783b1fbee113d4f7fa99cd13) Thanks [@porkytheblack](https://github.com/porkytheblack)! - A scene that throws fails in a second, and says what threw

  A render whose scene threw during its first render used to wait out the whole mount timeout — **measured at 188s against the 180s default** — and then report only `the scene never mounted within 180000ms`. The browser's own error had been captured within milliseconds and was sitting one line below, in a field a caller is free to ignore. An agent hitting this retried five times.

  Two causes, both fixed. The renderer now rejects the moment an uncaught page error arrives rather than waiting for a mount that cannot happen, and the error is recorded as well as signalled — most scene errors throw during navigation, before anything is listening, so signalling alone dropped exactly the common case. The message now leads with `the scene threw while rendering, so it never mounted`, carries the browser's error, and says plainly that it is the scene's fault rather than the renderer's.

  Measured after: **188s → 0.9s** for a bad easing name, **0.4s** for a plain `throw`.

  **`Easing` also grew up**, because the case that surfaced this was a scene reaching for `Easing.bezier` — which did not exist, so it threw `is not a function` from inside the runtime and pointed at the wrong file. It now carries `linear`, `in`, `out`, `inOut` (aliased `ease` / `easeIn` / `easeOut` / `easeInOut`), `quad`, `cubic`, `sin`, `expo`, `circle`, `back`, `bounce`, and a real `bezier(x1, y1, x2, y2)`. An unknown name now throws `Easing.elastic does not exist. Available: …` instead of `undefined`.

- Updated dependencies [[`5e9c527`](https://github.com/porkytheblack/glove/commit/5e9c5279ed0381ba01c72f4ef15d1fb88ea53cd0), [`fe2fd69`](https://github.com/porkytheblack/glove/commit/fe2fd6907dcaaea277859bb8ed4a06ddea3c459b), [`104478e`](https://github.com/porkytheblack/glove/commit/104478eb35b0fc2f43396b2b04afcc181fb81900), [`fa1b473`](https://github.com/porkytheblack/glove/commit/fa1b47358a9f030f0b36061340d870858d5a17bf), [`6d95d17`](https://github.com/porkytheblack/glove/commit/6d95d17078521ccb5e02a72c34f8d4de91c8092b), [`281fd23`](https://github.com/porkytheblack/glove/commit/281fd230eae3a26224b84f17d465b6a3e9f96868), [`f2e13ef`](https://github.com/porkytheblack/glove/commit/f2e13ef7dffa37649b6c4efc2e2ad4d1d3500128), [`4774ff3`](https://github.com/porkytheblack/glove/commit/4774ff3573167e5779e09e0d17238398546caaf5), [`e49bf99`](https://github.com/porkytheblack/glove/commit/e49bf994260336c4f689a709e6c32494f1643df2), [`4099b67`](https://github.com/porkytheblack/glove/commit/4099b671ca1ca9489cb12934859ea5d7c002e24d), [`fc3cd2b`](https://github.com/porkytheblack/glove/commit/fc3cd2b83fe5adc7dfbb4ef1d1ddf533d2769988), [`b57dfca`](https://github.com/porkytheblack/glove/commit/b57dfcac6454aceb33684bf6edc0cf7fd4708361), [`c47e4f0`](https://github.com/porkytheblack/glove/commit/c47e4f08d2b5ae30081e7ee393076dc15f44c182), [`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`37d84f6`](https://github.com/porkytheblack/glove/commit/37d84f6289689e333a3cce4f5d9c8530c8640eb1), [`2d3e974`](https://github.com/porkytheblack/glove/commit/2d3e9741254c00d3561a32118a34d59fd97dfa10), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`eeffd52`](https://github.com/porkytheblack/glove/commit/eeffd52a74666ca438d20bc2a48a7464c2ced38f), [`e696111`](https://github.com/porkytheblack/glove/commit/e6961110574c9ff2117fa47d9f1c36ef9e4c85dc), [`53d9c66`](https://github.com/porkytheblack/glove/commit/53d9c66e0e950fe4d69a5e5526125a94428a8b80), [`701f4d9`](https://github.com/porkytheblack/glove/commit/701f4d9a7cd37aef314d0521793bd960cf985fe8), [`568a250`](https://github.com/porkytheblack/glove/commit/568a2506ff1ccd280347ed5d5cc3698748b378f1), [`8fcfea7`](https://github.com/porkytheblack/glove/commit/8fcfea7baececdc85a7b144b55caf2e91ce8049d), [`f003e59`](https://github.com/porkytheblack/glove/commit/f003e591b2d0cae6608358c3e2c6e1a58bbb1e63), [`49f6e3a`](https://github.com/porkytheblack/glove/commit/49f6e3a27cf2122c51c1e32e9951ea12a12b01c3), [`1d6650a`](https://github.com/porkytheblack/glove/commit/1d6650a61257658f9e2276ce5238e50fd893dd34), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad), [`d72834d`](https://github.com/porkytheblack/glove/commit/d72834d8819d37b95c16809bf7e0e646073f6948), [`8df9ee3`](https://github.com/porkytheblack/glove/commit/8df9ee3ef41bd2f1b7c1234ef379ef0704d5a765), [`7ed19c3`](https://github.com/porkytheblack/glove/commit/7ed19c3521da4043147e8abb29326e2a2233b61c), [`ae34ca1`](https://github.com/porkytheblack/glove/commit/ae34ca1c56eaa65502afe3c6595d671bbc704860), [`78ffe34`](https://github.com/porkytheblack/glove/commit/78ffe34bd8ccb304239a65f931635053b93d4e50)]:
  - glove-working-environment@0.6.0
