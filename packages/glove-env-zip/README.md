# glove-env-zip

Archive stdlib adapter for [`glove-working-environment`](../glove-working-environment). Bridges zip, tar and tar.gz into the agent's virtual filesystem as **`env:archives`** — list and describe without extracting, extract selectively, and package a directory back up as one file.

```bash
pnpm add glove-env-zip
```

> **The package is `glove-env-zip`; the module it registers is `env:archives`.**
> The mismatch is deliberate. `env:archives` is the name agents write in their
> scripts, and it is recorded in snapshots and in the adapter-version file, so
> renaming it would break restore for anyone holding one — and it is the more
> accurate name besides, since this reads tar and tar.gz as well as zip. The
> npm name is only how you install it.

Dependency-free: `node:zlib` and the container formats themselves.

```ts
import { createWorkingEnvironment } from "glove-working-environment";
import { archives } from "glove-env-zip";

const env = await createWorkingEnvironment({ stdlib: [archives()] });
```

## Why

Archives are how batches of files actually arrive — an export from another system, a bundle of scans, a customer's data dump. An agent handed `/inbox/records.zip` was simply stuck: nothing could open it, and no verb would. They are also the natural way to hand a multi-file deliverable *back*, as one file rather than an array the host has to write out itself.

## What the model gets

| Function | Does |
|---|---|
| `describe(path)` | Entry count, file count, archive size, extracted size, a sample — without extracting |
| `list(path)` | Every entry, still without extracting |
| `extract(path, dir, { include? })` | Writes matching entries into `dir`; returns the paths written |
| `create(dir, output, { glob?, format? })` | Packages a directory into one archive |

```js
import { describe, extract } from 'env:archives';
import { readFile } from 'env:fs';
import { csv } from 'env:std';

/** Totals every CSV in a mounted archive. */
export default async function main() {
  const summary = await describe('/inbox/records.zip');
  if (summary.uncompressedBytes > 50_000_000) return { skipped: 'too large', summary };

  const written = await extract('/inbox/records.zip', '/inbox/records', { include: '**/*.csv' });
  let total = 0;
  for (const path of written) {
    for (const row of csv.parse(await readFile(path))) total += Number(row.amount ?? 0);
  }
  return { files: written.length, total };
}
```

`describe()` before `extract()` is the habit worth having: it reports the entry count and the extracted size without spending either.

## Extraction is the part that has to be right

A zip reader that round-trips its own output but writes outside the destination when handed a hostile archive has failed at the only job that is hard. The tests that matter here are the refusals, not the round trips.

- **Escaping names.** A name that climbs out of the destination, an absolute path, backslash separators — all refused, by name. The check is on the *resolved* path rather than the spelling, because climbing segments normalise away before any string comparison would catch them. A name that climbs but resolves back inside the destination is allowed: refusing it would reject archives real tools produce.
- **Runaway expansion.** The declared uncompressed size is supplied by the file itself, so it is checked *and* the decompression is capped at the environment's `maxVfsBytes`. An archive that declares ten bytes and expands to five megabytes fails at the cap, not at the claim. `.tar.gz` gets the same treatment before the tar is even parsed — it has no declared size to check at all.
- **Entry counts** are bounded, so an archive of a million empty entries cannot spend the whole budget on overhead.
- **Extracted bytes count against `maxVfsBytes`** like any other write, because they go through the same guarded handle.
- **Nested archives are not extracted recursively.** An extracted `.zip` is just a file; extracting it is a second, separately budgeted call.

What cannot be read honestly is refused rather than half-read: encrypted entries, ZIP64, unsupported compression methods, and tar entries that are symlinks, devices or hard links. A silently-wrong extraction is worse than a failed one.

## Formats

| Format | Read | Write | Notes |
|---|---|---|---|
| `.zip` | ✅ | ✅ | store + deflate; ZIP64 and encryption refused |
| `.tar` | ✅ | ✅ | regular files and directories; GNU/PAX long names |
| `.tar.gz` / `.tgz` | ✅ | ✅ | the above, through gzip |

Format is detected from the **bytes**, not the extension — a zip named `.tar` is still read as a zip. Output format follows the extension of `output` unless `format` overrides it.

Archives are also claimed by the `describe` verb, so `describe('/inbox/records.zip')` from the tool surface routes here without writing a script.
