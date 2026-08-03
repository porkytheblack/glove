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
| `describe(path)` | Format, dimensions, colour space, alpha, EXIF orientation — no pixel decoding |
| `stats(path)` | Channel means/spread, dominant colour, opacity — decodes pixels; answers "is this page blank?" |
| `resize(input, output, opts)` | `fit`: cover / contain / inside / outside / fill, `withoutEnlargement` |
| `convert(input, output, opts)` | Re-encode; format follows the output extension |
| `crop(input, output, box)` | Pixel rectangle from the top-left |
| `rotate(input, output, opts?)` | By angle, or auto-orient from EXIF when no angle is given |
| `composite(input, output, layers)` | Overlay with `gravity` and `opacity` |
| `thumbnail(input, output, size?)` | Square, cropped to fill |
| `contactSheet(inputs, output, opts?)` | Tile many images into one grid — a whole set inspectable at a glance |

## Design notes

**The output extension picks the encoder.** `resize('/a.png', '/out/b.webp')` writes WebP. Writing PNG bytes into a `.jpg` is the kind of mistake that surfaces three steps later, so the extension wins unless `{ format }` says otherwise. An output path with no recognisable extension is refused with the list of formats that work.

**EXIF orientation is surfaced, not silently applied.** `describe` reports `orientation: 6` so a script knows the stored pixels are sideways; `rotate(input, output)` with no angle normalises them. Cropping a sideways image without normalising first gives coordinates on the wrong axis, and nothing else would have told you.

**`stats` ignores alpha when averaging brightness** — otherwise every transparent PNG reads as dark.

Arguments are validated before reaching sharp, so a bad crop box or an empty layer list produces a sentence, not a library stack trace, and every failure names the file that caused it.

## License

MIT
