/**
 * The tiny module a scene imports, emitted into the staging directory as real
 * source and aliased to `glove/motion` for the bundle.
 *
 * It is written as a string rather than shipped as a file because it has to be
 * compiled *with* the scene — same React instance, same JSX runtime, same
 * bundle. A published module resolved separately would give the page two
 * Reacts, and hooks would throw.
 */
export const RUNTIME_SOURCE = `import { useEffect, useState } from 'react';

/**
 * The current frame, as a number.
 *
 * A scene built on this is a pure function of the frame, so any frame can be
 * rendered on its own — which is what makes seeking and re-rendering one bad
 * frame possible. Prefer it for anything you will want to iterate on.
 */
export function useFrame() {
  const [frame, setFrame] = useState(() => window.__gloveFrame.frame);
  useEffect(() => window.__gloveOnFrame(setFrame), []);
  return frame;
}

/** fps, dimensions and length — whatever the renderer was told to produce. */
export function useVideoConfig() {
  const { fps, durationInFrames, width, height } = window.__gloveFrame;
  return { fps, durationInFrames, width, height };
}

/** Seconds elapsed at the current frame. */
export function useTime() {
  const frame = useFrame();
  return frame / window.__gloveFrame.fps;
}

/**
 * Map a frame range onto an output range, clamped at both ends.
 *
 * Clamping is the default because the alternative — a value that keeps
 * growing past the end of its range — is almost never what a scene means, and
 * it fails as an element drifting off-screen rather than as an error.
 */
export function interpolate(input, inputRange, outputRange, options) {
  const easing = options?.easing ?? ((t) => t);
  // \`Easing.out(Easing.cubic)\` is the shape other libraries use, and here it
  // evaluates the curve AT a function, yielding NaN. The failure then surfaces
  // as "easing is not a function" from inside this file, which names neither
  // the scene nor the option that was wrong.
  if (typeof easing !== 'function') {
    throw new Error(
      \`interpolate got easing: \${typeof easing === 'number' && Number.isNaN(easing) ? 'NaN' : JSON.stringify(easing)}, which is not a function. \` +
        'Pass the curve itself — { easing: Easing.out } — not a call like Easing.out(Easing.cubic). ' +
        'For a custom curve use Easing.bezier(x1, y1, x2, y2) or any (t) => number.'
    );
  }
  let i = 0;
  while (i < inputRange.length - 2 && input > inputRange[i + 1]) i++;
  const [inMin, inMax] = [inputRange[i], inputRange[i + 1]];
  const [outMin, outMax] = [outputRange[i], outputRange[i + 1]];
  if (inMax === inMin) return outMax;
  let t = (input - inMin) / (inMax - inMin);
  t = Math.max(0, Math.min(1, t));
  return outMin + easing(t) * (outMax - outMin);
}

/** A spring-ish ease that reads better than linear for entrances. */
export function spring(t) {
  return 1 - Math.pow(2, -10 * t) * Math.cos((t * Math.PI * 2) / 0.6);
}

/**
 * Cubic bezier, the same four numbers CSS takes.
 *
 * Solved by bisection rather than Newton: 24 iterations is exact enough for a
 * pixel and has no convergence edge cases to get wrong.
 */
function bezier(x1, y1, x2, y2) {
  const curve = (a, b, t) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (curve(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return curve(y1, y2, (lo + hi) / 2);
  };
}

const EASINGS = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  sin: (t) => 1 - Math.cos((t * Math.PI) / 2),
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  circle: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  bounce: (t) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
  bezier,
};

// The names other motion libraries use, so a scene written from muscle memory
// works instead of crashing on \`undefined is not a function\`.
EASINGS.ease = EASINGS.inOut;
EASINGS.easeIn = EASINGS.in;
EASINGS.easeOut = EASINGS.out;
EASINGS.easeInOut = EASINGS.inOut;

/**
 * Reaching for an easing that does not exist should say so.
 *
 * \`Easing.elastic\` is plain \`undefined\`, and passing it to \`interpolate\`
 * throws "is not a function" from inside the runtime — a message that points
 * at the wrong file. The proxy names the mistake and lists the way out.
 */
export const Easing = new Proxy(EASINGS, {
  get(target, key) {
    if (typeof key !== 'string' || key in target) return target[key];
    // Bundlers, React and Promise resolution all probe for odd keys; only a
    // plain identifier-looking miss is a real authoring mistake.
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) return undefined;
    throw new Error(
      \`Easing.\${key} does not exist. Available: \${Object.keys(target).sort().join(', ')} — \` +
        \`or build your own with Easing.bezier(x1, y1, x2, y2), or pass any (t) => number.\`
    );
  },
});

/** Show children only between two frames. */
export function Sequence({ from = 0, durationInFrames = Infinity, children }) {
  const frame = useFrame();
  if (frame < from || frame >= from + durationInFrames) return null;
  return children;
}
`;

/**
 * The generated entry.
 *
 * `__gloveMounted` is set from inside a React effect rather than after the
 * render call, because `createRoot().render()` returns before React has
 * committed anything. Screenshotting on the earlier signal catches a blank
 * page often enough to look like a broken renderer.
 */
export const entrySource = (sceneImportPath: string): string => `import React from 'react';
import { createRoot } from 'react-dom/client';
import Scene from ${JSON.stringify(sceneImportPath)};

function Root() {
  React.useEffect(() => { window.__gloveMounted = true; }, []);
  return React.createElement(Scene, null);
}

const el = document.getElementById('root');
createRoot(el).render(React.createElement(Root, null));
`;
