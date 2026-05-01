# Glovebox base images

Premade Docker images that Glovebox apps extend via `base: "glovebox/<name>"`
in their wrap config. Each image inherits from `glovebox/base`, layers in
domain-specific tooling, and (where applicable) registers a set of subagent
mentions the agent can route to.

| Image | Tag | Adds |
|---|---|---|
| `glovebox/base` | 1.0 | Node 20, `glovebox` user, /work/input/output layout, prebuilt better-sqlite3 |
| `glovebox/media` | 1.4 | ffmpeg, imagemagick, sox, yt-dlp, Python (for yt-dlp) |
| `glovebox/docs` | 1.2 | pandoc, qpdf, pdftk-java, ghostscript, libreoffice headless |
| `glovebox/python` | 1.3 | uv + scientific stack (numpy, pandas, pillow, scipy, matplotlib) |
| `glovebox/browser` | 1.1 | Playwright with bundled Chromium |

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
