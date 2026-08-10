# glove-env-images

Image stdlib adapter for [`glove-working-environment`](../glove-working-environment). Registers `env:images`, backed by [sharp](https://sharp.pixelplumbing.com).

```bash
pnpm add glove-env-images
```

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { images } from "glove-env-images";

const env = await createWorkingEnvironment({ stdlib: [images()] });
```

## The point: one run, fifty files

A model cannot read image bytes, and shuttling them through the context window is the worst possible use of it. So image data never leaves the tree — `describe` answers *what am I holding* in a few dozen tokens, and everything else turns one path into another.

```js
import { glob } from 'env:fs';
import { describe, resize } from 'env:images';

export default async function main(args) {
  const paths = await glob('/inbox/**/*.{jpg,png}');
  let resized = 0;
  for (const path of paths) {
    const meta = await describe(path);
    if (meta.width <= args.maxWidth) continue;
    await resize(path, '/out/' + path.split('/').pop().replace(/\.\w+$/, '.webp'),
                 { width: args.maxWidth, fit: 'inside', quality: 82 });
    resized++;
  }
  return { resized, skipped: paths.length - resized };
}
```

## What it gives the model

| Function | Notes |
|---|---|
| `describe(path)` | Format, dimensions, frame count, colour space, alpha, EXIF orientation — no pixel decoding |
| `stats(path)` | Channel means/spread, dominant colour, opacity — decodes pixels; answers "is this page blank?" |
| `resize(input, output, opts)` | `fit`: cover / contain / inside / outside / fill, `withoutEnlargement` |
| `convert(input, output, opts)` | Re-encode, including rasterizing an `.svg` at a chosen `scale`/`density` |
| `crop(input, output, box)` | Pixel rectangle from the top-left — of one frame, when animated |
| `rotate(input, output, opts?)` | By angle, or auto-orient from EXIF when no angle is given |
| `composite(input, output, layers)` | Overlay with `gravity` and `opacity` |
| `text(input, output, opts)` | Draw text — watermark, date, caption — with a halo so it survives a pale image |
| `thumbnail(input, output, size?)` | Square, cropped to fill |
| `contactSheet(inputs, output, opts?)` | Tile many images into one grid — a whole set inspectable at a glance |

## Design notes

**The output extension picks the encoder.** `resize('/a.png', '/out/b.webp')` writes WebP. Writing PNG bytes into a `.jpg` is the kind of mistake that surfaces three steps later, so the extension wins unless `{ format }` says otherwise. An output path with no recognisable extension is refused with the list of formats that work.

**EXIF orientation is surfaced, not silently applied.** `describe` reports `orientation: 6` so a script knows the stored pixels are sideways; `rotate(input, output)` with no angle normalises them. Cropping a sideways image without normalising first gives coordinates on the wrong axis, and nothing else would have told you.

**`stats` ignores alpha when averaging brightness** — otherwise every transparent PNG reads as dark.

**Animations keep their frames, and the output format decides.** libvips holds an animated GIF/WebP as a single tall strip of frames, and only the GIF and WebP encoders can write that strip back out as frames — hand it to the PNG encoder and you get one image thirty times too tall, which is worse than the flattening it was meant to avoid. So the decision is made against the *output* format: `.gif`/`.webp` keeps every frame through `resize`, `convert`, `crop`, `thumbnail`, `composite` and `text`; anything else takes frame one, which is what a still format means. `{ animated: false }` flattens deliberately. `rotate` is the exception and says so rather than guessing: libvips refuses a quarter turn on a multi-page image and a half turn reverses the frame order, so an animation is refused unless you ask for frame one.

**SVG is read-only.** sharp rasterizes it and has no SVG encoder, so `.svg` is claimed as input and refused as output — writing PNG bytes into a file named `.svg` would only be discovered by whatever opens it next. `{ scale: 2 }` or `{ density: 300 }` picks the rasterization resolution; a `resize` renders the vector *at* the target size rather than blowing up a small raster.

Arguments are validated before reaching sharp, so a bad crop box or an empty layer list produces a sentence, not a library stack trace, and every failure names the file that caused it.

## License

MIT
