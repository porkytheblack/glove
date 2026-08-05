/**
 * What the model reads: `/std/motion/index.d.ts`, `/std/motion/README.md` and
 * a `/skills` recipe.
 *
 * The docs lean hard on one thing — write the scene, then render it — because
 * the failure this adapter invites is an agent trying to drive a browser or
 * call ffmpeg itself. It cannot. It writes a component and names an output
 * file.
 */
import type { Skill } from "glove-working-environment";

export const MOTION_TYPES = `/**
 * env:motion — React scenes to video, GIF, frames and stills.
 *
 * Everything here is ASYNC. A render opens a real browser and screenshots
 * every frame, so it is SLOW: budget roughly a second per 10 frames.
 */

export interface RenderArgs {
  /** Frames per second. Default 30. */
  fps?: number;
  /** Length in frames. Takes precedence over durationSeconds. */
  durationInFrames?: number;
  /** Length in seconds. Default 3. */
  durationSeconds?: number;
  /** Default 1280. */
  width?: number;
  /** Default 720. */
  height?: number;
  /** CSS colour behind the scene. Default '#ffffff'. */
  background?: string;
  /**
   * 'clock' (default) advances time 1/fps per frame — for Reanimated and
   * anything animating against a clock.
   * 'frame' sets the frame number directly — for scenes using useFrame().
   */
  mode?: 'clock' | 'frame';
  /** x264/vp9 quality, 0-51. Lower is better and bigger. Default 18. */
  crf?: number;
  /** Also write the PNG frames to this directory. */
  keepFrames?: string;
}

export interface RenderResult {
  path: string;
  width: number;
  height: number;
  fps?: number;
  frames: number;
  durationSeconds?: number;
  bytes?: number;
  files?: string[];
  /** Non-fatal problems. An empty array is the good case — READ IT. */
  warnings: string[];
}

/**
 * Render a scene file to a deliverable. The extension picks the format:
 * .mp4 / .webm / .gif / .png, or an extensionless path for a directory of
 * PNG frames.
 */
export function render(scenePath: string, outPath: string, args?: RenderArgs): Promise<RenderResult>;

/** One frame as a PNG. Defaults to mode 'frame' and frame 0. */
export function still(
  scenePath: string,
  outPath: string,
  args?: RenderArgs & { frame?: number },
): Promise<RenderResult>;

/** What this host can do, without spending a render to find out. */
export function capabilities(): Promise<{
  browser: string | null;
  canRender: boolean;
  reanimated: boolean;
  maxFrames: number;
  formats: string[];
}>;
`;

export const MOTION_DOCS = `# env:motion

Write a React component; get a video, a GIF, PNG frames or a still image.

\`\`\`js
import { render, still } from 'env:motion';
\`\`\`

## The two-step shape

You do **not** drive a browser or call ffmpeg. You write a scene file with
\`write_file\`, then name it and an output:

1. Write \`/scenes/intro.jsx\` — a React component, default-exported.
2. \`await render('/scenes/intro.jsx', '/out/intro.mp4', { durationSeconds: 4 })\`

The output extension picks the format: \`.mp4\`, \`.webm\`, \`.gif\`, \`.png\`,
or a path with no extension for a directory of numbered PNG frames.

## Writing a scene

Two ways to make things move. **Prefer the first.**

### useFrame() — a pure function of the frame number

\`\`\`jsx
import { useFrame, useVideoConfig, interpolate, Easing } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { fps, width } = useVideoConfig();
  const x = interpolate(frame, [0, fps * 2], [0, 400], { easing: Easing.inOut });
  const opacity = interpolate(frame, [0, 15], [0, 1]);

  return (
    <div style={{ width, height: 720, background: '#0b0b10', display: 'grid', placeItems: 'center' }}>
      <h1 style={{ color: 'white', font: '600 72px system-ui', transform: \\\`translateX(\\\${x}px)\\\`, opacity }}>
        Q3 Revenue
      </h1>
    </div>
  );
}
\`\`\`

Pass \`mode: 'frame'\` when you render this. Any frame can be produced on its
own, so you can check frame 90 without rendering the 89 before it — which is
how you iterate cheaply.

### Reanimated — real React Native motion code

\`\`\`jsx
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

export default function Scene() {
  const x = useSharedValue(0);
  useEffect(() => { x.value = withTiming(600, { duration: 2000 }); }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={{ width: 1280, height: 720, backgroundColor: '#0b0b10', justifyContent: 'center' }}>
      <Animated.View style={[{ width: 160, height: 160, backgroundColor: '#7c5cff' }, style]} />
    </View>
  );
}
\`\`\`

This runs under the default \`mode: 'clock'\`. Animations start on mount and
the renderer advances time frame by frame, so a two-second \`withTiming\` takes
exactly two seconds of video.

## Stills

A one-frame render is an image, so the same component makes a chart, a title
card or a social graphic:

\`\`\`js
await still('/scenes/card.jsx', '/out/card.png', { width: 1200, height: 630 });
await still('/scenes/intro.jsx', '/tmp/check-90.png', { frame: 90 });   // spot-check one frame
\`\`\`

## Check what you made

\`render\` returns \`warnings\`. **An empty array is the good case.** The one
that matters most says every frame came out identical — that means the scene
is not animating, and the video is technically valid but useless.

Then look at it. \`view_image\` on a still, or on a frame pulled with
\`keepFrames\`, is the only way to catch a title off the edge or text the same
colour as the background:

\`\`\`js
const out = await render('/scenes/intro.jsx', '/out/intro.mp4', { keepFrames: '/tmp/frames' });
if (out.warnings.length) throw new Error(out.warnings.join('; '));
\`\`\`

\`\`\`
view_image({ path: '/tmp/frames/frame-00045.png',
             prompt: 'Is the heading fully inside the frame, and readable against the background?' })
\`\`\`

## Costs and limits

- **Rendering is slow.** Every frame is a browser screenshot — roughly a
  second per 10 frames. A 10-second clip at 30fps is 300 frames.
- Prefer **short scenes at 30fps**. Ask for 60fps only when something moves
  fast enough to need it.
- There is a hard frame ceiling per render; \`capabilities()\` reports it.
- Renders are **deterministic**: the same scene produces the same bytes, so
  re-rendering after an edit shows a real difference.
`;

export const MOTION_SKILL: Skill = {
  name: "motion-scenes",
  summary: "Writing a scene that renders to video or an image, and checking it.",
  body: `# Making something move

\`env:motion\` renders a React component to video or an image. You write the
component; you do not drive a browser.

## The loop that works

**1. Write the scene.** One file, default-exporting a component.

\`\`\`jsx
// /scenes/intro.jsx
import { useFrame, useVideoConfig, interpolate, Easing } from 'glove/motion';

export default function Scene() {
  const frame = useFrame();
  const { fps } = useVideoConfig();
  const y = interpolate(frame, [0, fps], [40, 0], { easing: Easing.out });
  const opacity = interpolate(frame, [0, fps * 0.5], [0, 1]);
  return (
    <div style={{ width: 1280, height: 720, background: '#0b0b10', display: 'grid', placeItems: 'center' }}>
      <h1 style={{ color: '#fff', font: '600 64px system-ui', transform: \\\`translateY(\\\${y}px)\\\`, opacity }}>
        Q3 Revenue
      </h1>
    </div>
  );
}
\`\`\`

**2. Check one frame before rendering all of them.** A still costs one
screenshot; a 5-second video costs 150.

\`\`\`js
import { still } from 'env:motion';
export default async function main() {
  return still('/scenes/intro.jsx', '/tmp/f30.png', { frame: 30, mode: 'frame' });
}
\`\`\`

Then \`view_image\` it. Layout mistakes — text off the edge, white on white,
an element behind another — are invisible in code and obvious in the picture.

**3. Render, and read the warnings.**

\`\`\`js
const out = await render('/scenes/intro.jsx', '/out/intro.mp4',
                         { durationSeconds: 4, mode: 'frame' });
if (out.warnings.length) throw new Error(out.warnings.join('; '));
\`\`\`

## The mistakes that cost a render

**Forgetting \`mode\`.** \`useFrame()\` scenes need \`mode: 'frame'\`.
Reanimated scenes need \`mode: 'clock'\` (the default). Get it wrong and every
frame is identical — you get a valid video of a still image.

**Rendering long before checking short.** Iterate on a still. Only render the
whole thing once it looks right.

**Sizes that are not even numbers.** H.264 needs even dimensions. Stick to
1280x720, 1920x1080, 1080x1080, 1200x630.

**Assuming a font exists.** The browser has system fonts and nothing else.
\`system-ui\`, \`serif\`, \`monospace\` are safe; a specific family is not.

## Stills are the cheap win

Not everything that needs a picture needs a video. A chart, a title card, a
social image, a diagram — one frame, one call:

\`\`\`js
await still('/scenes/card.jsx', '/out/card.png', { width: 1200, height: 630 });
\`\`\`
`,
};
