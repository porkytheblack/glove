# Glovebox base images

Premade Docker images that Glovebox apps extend via `base: "glovebox/<name>"`
in their wrap config. Each image inherits from `glovebox/base`, layers in
domain-specific tooling, and (where applicable) registers a set of subagent
mentions the agent can route to.

| Image | Tag | Adds |
|---|---|---|
| `glovebox/base` | 1.1 | Node 22, `glovebox` user, /work/input/output layout, prebuilt better-sqlite3 |
| `glovebox/media` | 1.5 | ffmpeg, imagemagick, sox, yt-dlp, Python (for yt-dlp) |
| `glovebox/docs` | 1.3 | pandoc, qpdf, pdftk-java, ghostscript, libreoffice headless |
| `glovebox/python` | 1.4 | uv + scientific stack (numpy, pandas, pillow, scipy, matplotlib) |
| `glovebox/browser` | 1.2 | Playwright with bundled Chromium |
| `glovebox/studio` | 1.1 | docs + Chromium — the one image where `env:render` and `env:motion` both work |

### Which one for a working environment

`glove-working-environment` adapters have base-image requirements, and two of
them disagreed until `studio` existed: `env:render` rasterizes through
headless LibreOffice, `env:motion` renders React scenes in a headless browser,
and `docs` has no browser while `browser` has no LibreOffice. An agent that
can build a deck but not look at it is half an agent, so `studio` is `docs`
plus Chromium. `examples/glovebox-env` is the worked proof: it builds against
`studio`, and its selfcheck runs both adapters inside the container.

### Node 22, from base 1.1 on

The bump from Node 20 is not cosmetic. pdf.js — pdfjs-dist v5+, which
`env:render` rasterizes through — calls
`ArrayBuffer.prototype.transferToFixedLength`, added in Node 21. When it is
missing pdf.js catches the error per operator, logs `getOperatorList -
ignoring errors`, and finishes the page anyway. Measured in-container on the
Node 20 base: a rasterized Word document reported a path, 893x1263 dimensions
and 7224 bytes, every layer above called it a success, and the PNG was blank.
Node 20 also left maintenance in April 2026. Every image's tag moved because
every image contains the new runtime.

## Building locally

```sh
./build.sh                      # build all images, tag :local
./build.sh media                # build a single image
./build.sh --push --tag 1.4     # build + push to the configured registry
```

The `build.sh` script honors:

- `REGISTRY=ghcr.io/porkytheblack` — registry prefix
- `PLATFORM=linux/amd64,linux/arm64` — platforms (default: amd64)

## Releasing

The `release.yml` workflow builds and pushes all five images to GHCR on
`workflow_dispatch`. Manual trigger only — base-image churn should be
deliberate.

## Threat model notes

- All images run as `uid 10001 (glovebox)` with no sudo.
- `/input` is `chmod 555 root:root` so the agent can read but not modify
  caller-provided files.
- `/work` and `/output` are `glovebox`-owned.
- Network egress is the platform's responsibility — the image doesn't
  enforce it. Pair with a CNI policy or k8s NetworkPolicy if you need an
  allowlist.
