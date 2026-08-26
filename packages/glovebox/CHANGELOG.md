# glovebox-core

## 0.6.0

### Minor Changes

- [#144](https://github.com/porkytheblack/glove/pull/144) [`331f612`](https://github.com/porkytheblack/glove/commit/331f612ff352590d6716ce0ae0b0774148d865a6) Thanks [@claude](https://github.com/apps/claude)! - Glovebox can run a working environment.

  `glovebox build` inlined everything except `better-sqlite3`, so an agent that
  mounted `glove-working-environment` built fine and died at its first
  `run_script`: the hub opens its script worker by URL, and a bundled
  `import.meta.url` points at the bundle. `env:motion` and `env:render` failed
  the same way — both resolve their own package directory at run time.

  The build now splits externals two ways. The env family (`glove-working-environment`,
  `glove-env-*`) is **vendored** into `dist/server/vendor/` at the exact build
  it was compiled against and copied into `node_modules` _after_ `npm install`,
  because npm prunes what it did not put there. Packages with a platform binary
  (sharp, `@napi-rs/canvas`, esbuild, playwright-core, the ffmpeg installers)
  are **declared** in the emitted `package.json` so the container installs the
  binary for its own platform.

  Three fixes this needed along the way:

  - **`glovebox build` could not load a multi-file wrap module.** It plain
    `import()`ed the entry, so a TypeScript wrap module importing `./agent`
    failed with `ERR_MODULE_NOT_FOUND` naming a file that is plainly there —
    including in `examples/glovebox-pdf-extractor`, which ships in this repo.
    It now registers tsx for a TypeScript entry, so the graph loads file by
    file with ordinary resolution.
  - **Package resolution missed ESM-only packages.** It resolved through
    `createRequire`, which answers under the `require` condition; an exports map
    with no `require` branch returns `ERR_PACKAGE_PATH_NOT_EXPORTED`. Of the
    four env packages in the new example, exactly one resolved — the rest,
    `glove-working-environment` included, were silently left out of the image.
    Resolution now walks `node_modules` for the directory, which is all it ever
    needed.
  - **Node builtins were treated as npm packages.** `fs`, `path` and `crypto`
    were reported to the user as missing installs, while `buffer`, `events` and
    `https` resolved to userland shims that happened to be installed and got
    written into the server's `package.json` — making the image install
    polyfills that shadow the real builtins.

  `env:render` also gained a runtime preflight: pdf.js v5+ needs
  `ArrayBuffer.prototype.transferToFixedLength` (Node 21+), and without it
  swallows the error per operator and returns a **blank page** while every layer
  above reports success. It now refuses with a message naming the cause.

### Patch Changes

- Updated dependencies [[`f600236`](https://github.com/porkytheblack/glove/commit/f600236010a168040b9eb9b6cb0ff1b8f9c7608a), [`bfbb73b`](https://github.com/porkytheblack/glove/commit/bfbb73bf3cc2ae4c9b2f3a714a920cfcb60232bb), [`ef623ec`](https://github.com/porkytheblack/glove/commit/ef623ec744118723a6b45f6166274316e86a9109), [`443e414`](https://github.com/porkytheblack/glove/commit/443e41424b47106228f8a1a8743871f146c484ad)]:
  - glove-core@3.6.0
  - glovebox-kit@0.5.1
