/**
 * The synthetic clock, as a string injected into the page before anything else.
 *
 * This is the whole trick, and it is worth being precise about why it is
 * needed. A browser animation is a function of wall-clock time: the same scene
 * screenshotted twice gives two different pictures, and a renderer that fell
 * behind by 4ms would silently emit a frame from the wrong moment. Neither is
 * acceptable for a video, where frame N must be exactly N.
 *
 * So time is replaced rather than measured. `requestAnimationFrame` becomes a
 * queue nobody drains except us, and `performance.now()` / `Date.now()` return
 * a number we set. One `advance(ms)` is one frame: it moves the number, then
 * fires every callback registered up to that point. A callback that
 * re-registers — which is what an animation loop does — lands in the next
 * batch rather than spinning forever inside this one.
 *
 * Measured consequence: two independent runs of the same scene produce
 * byte-identical PNGs for all 60 frames. That is what makes a re-render after
 * an edit a real diff, and what makes a failed render resumable.
 *
 * `settle()` deliberately uses the ORIGINAL `requestAnimationFrame`, captured
 * before the override. React schedules through MessageChannel, not rAF, so
 * after advancing we need to let the browser actually reach a paint — and the
 * only thing that can tell us it did is the real frame loop we just replaced.
 */
export const CLOCK_SHIM = `(() => {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();
  const realRaf = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { callbacks.delete(id); };

  performance.now = () => now;
  Date.now = () => now;

  window.__gloveClock = {
    now: () => now,
    pending: () => callbacks.size,
    /** Advance to a frame and run every callback waiting for it. */
    advance(ms) {
      now += ms;
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const cb of due) {
        try { cb(now); } catch (e) { (window.__gloveErrors ||= []).push(String(e)); }
      }
      return due.length;
    },
    /** Two real frames — enough for React to commit and the compositor to paint. */
    settle: () => new Promise((resolve) => realRaf(() => realRaf(() => resolve(undefined)))),
  };
  window.__gloveErrors = [];
})();`;

/**
 * The frame-driven alternative to an animation library, injected as a global.
 *
 * Reanimated animates against a clock, which this renderer supplies — that
 * works, and it is what lets existing React Native motion code render here
 * unchanged. But a clock-driven scene can only be played from the start: to
 * reach frame 900 you must run 899 frames first, and nothing can be rendered
 * out of order or in parallel.
 *
 * `useFrame()` is the other shape. A scene that reads the frame NUMBER is a
 * pure function of it, so any frame can be produced directly. That is what
 * makes seeking, re-rendering one bad frame, and eventually splitting a render
 * across workers possible at all.
 *
 * Both are offered because they are good at different things, and the choice
 * belongs to whoever writes the scene.
 */
export const FRAME_GLOBALS = `(() => {
  window.__gloveFrame = { frame: 0, fps: 30, durationInFrames: 0, width: 0, height: 0 };
  const listeners = new Set();
  window.__gloveSetFrame = (f) => {
    window.__gloveFrame.frame = f;
    for (const l of listeners) l(f);
  };
  window.__gloveOnFrame = (l) => { listeners.add(l); return () => listeners.delete(l); };
  // How the renderer tells a frame-driven scene from a clock-driven one: a
  // useFrame() scene subscribes here on mount, and a scene with subscribers
  // and no pending clock callbacks can be JUMPED to any frame directly.
  window.__gloveFrameListenerCount = () => listeners.size;
})();`;
