---
"glovebox-core": minor
"glove-env-render": patch
---

Glovebox can run a working environment.

`glovebox build` inlined everything except `better-sqlite3`, so an agent that
mounted `glove-working-environment` built fine and died at its first
`run_script`: the hub opens its script worker by URL, and a bundled
`import.meta.url` points at the bundle. `env:motion` and `env:render` failed
the same way — both resolve their own package directory at run time.

The build now splits externals two ways. The env family (`glove-working-environment`,
`glove-env-*`) is **vendored** into `dist/server/vendor/` at the exact build
it was compiled against and copied into `node_modules` *after* `npm install`,
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
