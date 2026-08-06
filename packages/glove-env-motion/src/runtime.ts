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

export const Easing = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

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
