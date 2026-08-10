# glovebox-env

A working environment inside a Glovebox container — and the proof that it runs.

`glovebox build` produces a single-file server bundle. That is right for
ordinary JavaScript and wrong for `glove-working-environment`, which starts
every script in a worker thread it opens **by URL**:

```js
new Worker(new URL("./worker.js", import.meta.url))
```

Inlined into a bundle, `import.meta.url` becomes the bundle's own path and the
probe finds nothing. `env:motion` and `env:render` break the same way for the
same reason — motion derives its package root from `import.meta.url` to find
the React and Babel it ships with, render calls
`require.resolve("pdfjs-dist/package.json")` to locate pdf.js's font data.
Every one of those answers is wrong once the code lives somewhere else, and
none of them fails at build time. They fail at the first `run_script`.

So the build **vendors** the env family instead of bundling it, and
**declares** native packages for the container to install. See
`packages/glovebox/src/build/externals.ts` for the split and why it is a split.

## Running it

```sh
pnpm build            # glovebox build ./glovebox.ts  → dist/
pnpm image            # docker build -t glovebox-env:local ./dist
pnpm selfcheck        # docker run … GLOVEBOX_SELFCHECK=1
```

`pnpm build` reports what it vendored and what the image will install:

```
✓ Resolved base image: ghcr.io/porkytheblack/glovebox/studio:1.1
✓ Vendored 4 module(s) kept out of the bundle: glove-env-documents,
  glove-env-motion, glove-env-render, glove-working-environment
✓ Declared 13 runtime dependenc(ies): @babel/core, …, react-dom
```

If `glove-working-environment` is not in the vendored list, the image will
build and then fail at the first script. That line is the check.

## The selfcheck

`GLOVEBOX_SELFCHECK=1` makes the wrap module run the checks instead of
starting the server — no model, no API key, no client. Each one is a failure
that is invisible until something actually runs:

| check | what breaks without it |
|---|---|
| worker | the hub inlined into the bundle: no `executor/worker.js` |
| documents | a vendored adapter whose npm deps were never installed |
| render | no LibreOffice, or pdf.js/@napi-rs/canvas built for the wrong platform |
| motion | no Chromium, or esbuild's binary missing from the bundle |
| video | no ffmpeg for the platform the image actually runs on |

Measured on `glovebox/studio:1.1`:

```
  ok    environment                    181ms   modules: fs, std, assert, documents, render, motion
  ok    worker                          39ms
  ok    documents                       93ms
  ok    render (LibreOffice + pdf.js)  3558ms
  ok    motion still (Chromium)        1743ms
  ok    motion video (ffmpeg)          2186ms
```

### Look at the output, don't trust the checkmark

A green row says the call returned without throwing. It does not say the PNG
has ink on it — and that distinction is not hypothetical. On the previous Node
20 base image, pdf.js logged `getOperatorList - ignoring errors` and carried
on; the render row reported a path, 893x1263 dimensions and 7224 bytes and
read as `ok`, and the page was **blank**. That is what moved the base image to
Node 22 (pdf.js needs `ArrayBuffer.prototype.transferToFixedLength`, added in
Node 21) and what put a runtime preflight in `env:render`.

So the selfcheck can hand its output back:

```sh
mkdir -p out && sudo chown 10001:10001 out    # the container runs as uid 10001
docker run --rm -v "$PWD/out:/export" \
  -e GLOVEBOX_KEY=selfcheck -e GLOVEBOX_SELFCHECK=1 \
  -e GLOVEBOX_SELFCHECK_EXPORT=/export glovebox-env:local
```

`out/` then holds `report.docx`, `pages/report-p1.png`, `frame.png` and
`intro.mp4`. Open them.

## Base image

`glovebox/studio` — `glovebox/docs` plus Chromium. `env:render` needs
LibreOffice and `env:motion` needs a browser; until studio existed no image had
both. Building the bases locally:

```sh
cd ../../docker && ./build.sh base docs studio
```
