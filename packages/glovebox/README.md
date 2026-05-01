# glovebox

Authoring kit and build CLI for shipping a [Glove](https://github.com/porkytheblack/glove) agent as a sandboxed, network-addressable service. Wrap a built `Glove` runnable, run `glovebox build`, ship the resulting Dockerfile (or nixpacks bundle) to any container host.

## Install

```sh
pnpm add glovebox glovebox-kit
```

`glovebox-kit` is the in-container runtime; `glovebox build` bakes it into the generated server bundle, so it must resolve at install time. The `glovebox` binary is installed into your project's `node_modules/.bin`.

## What it does

A normal `Glove` agent runs in-process: tools, displays, and storage all live wherever the host process happens to live. Glovebox packages that same agent as a long-running container that exposes one authenticated WebSocket endpoint per session. The agent gets:

- A clean `/work`, `/input`, `/output` filesystem layout, owned by an unprivileged `glovebox` user.
- A pinned base image with the system tools the agent declares (ffmpeg, pandoc, Playwright, ...).
- A `FileRef`-based wire protocol so caller files cross the network as references (inline / URL / server-hosted / S3), never raw blobs over WS frames.
- An auto-injected `environment` skill, `workspace` skill, `/output` hook, and `/clear-workspace` hook.

The build CLI emits a Dockerfile, a `nixpacks.toml` (Railway-flavored alternative), an esbuild server bundle (~150 KB), a manifest, and a generated bearer key. No app code runs at build time besides the entry import that hands over the wrapped runnable.

## Usage

### 1. Wrap a built runnable

`glovebox.wrap(runnable, config)` takes any object that satisfies `IGloveRunnable` (the result of `Glove.build()`) and returns an opaque `GloveboxApp`. The build CLI imports your entry file, reads `default` (or named `app`) from it, and consumes the wrap.

```ts
// glovebox.ts — the entry the build CLI compiles
import { Glove } from "glove-core/glove"
import { Displaymanager } from "glove-core/display-manager"
import { SqliteStore } from "glove-core"
import { createAdapter } from "glove-core/models/providers"
import { z } from "zod"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

import { glovebox, rule, composite } from "glovebox"

const exec = promisify(execFile)

const agent = new Glove({
  store: new SqliteStore({ dbPath: "/work/glove.db", sessionId: "trim" }),
  model: createAdapter({ provider: "anthropic", model: "claude-sonnet-4-20250514" }),
  displayManager: new Displaymanager(),
  systemPrompt:
    "You trim media files. Inputs land in /input, write trimmed files to /output.",
  compaction_config: { compaction_instructions: "Summarize the conversation." },
  serverMode: true,
})
  .fold({
    name: "trim",
    description: "Trim a media file with ffmpeg.",
    inputSchema: z.object({
      file: z.string().describe("Filename in /input"),
      start: z.string(),
      duration: z.string(),
    }),
    async do(input) {
      const out = path.join("/output", `trimmed-${input.file}`)
      await exec("ffmpeg", [
        "-y", "-i", path.join("/input", input.file),
        "-ss", input.start, "-t", input.duration, "-c", "copy", out,
      ])
      return { status: "success" as const, data: { out } }
    },
  })
  .build()

export default glovebox.wrap(agent, {
  name: "media-trimmer",
  base: "glovebox/media",
  packages: { apt: ["ffmpeg"] },
  env: {
    ANTHROPIC_API_KEY: { required: true, secret: true },
  },
  storage: {
    inputs: composite([rule.url(), rule.inline()]),
    outputs: composite([
      rule.inline({ below: "1MB" }),
      rule.localServer({ ttl: "1h" }),
    ]),
  },
  limits: { memory: "1Gi", timeout: "5m" },
})
```

### 2. Build

```sh
glovebox build ./glovebox.ts
# → ✓ Resolved base image: ghcr.io/porkytheblack/glovebox/media:1.4
#   ✓ Generated Dockerfile / nixpacks.toml / server bundle / auth key
#   ✓ Wrote dist/
```

`dist/` contains:

```
dist/
├── Dockerfile         # FROMs the resolved base, copies bundle
├── nixpacks.toml      # Railway-style alternative
├── glovebox.json      # manifest (env spec, fs layout, key fingerprint, storage policy)
├── glovebox.key       # generated bearer (gitignored, 0600)
├── .env.example       # filled from `env` config
└── server/
    ├── index.js       # esbuild bundle (~150 KB)
    ├── package.json   # only better-sqlite3 as runtime dep
    └── glovebox.json  # copy for runtime
```

### 3. Deploy

Anywhere that runs a container or honors nixpacks. The bearer key the build emitted is the one and only credential.

```sh
docker build -t my-trimmer ./dist
docker run -p 8080:8080 \
  -e GLOVEBOX_KEY="$(cat ./dist/glovebox.key)" \
  -e GLOVEBOX_PUBLIC_URL=https://trimmer.example.com \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  my-trimmer
```

Railway / Render / Fly: point the platform at `dist/nixpacks.toml`, set the same env vars, ship.

## Config reference

```ts
interface GloveboxConfig {
  name?: string                                 // defaults to "glovebox-app"
  version?: string                              // defaults to "0.1.0"
  base?: BaseImage                              // defaults to "glovebox/base"
  packages?: { apt?: string[]; pip?: string[]; npm?: string[] }
  fs?: Record<string, { path: string; writable: boolean }>
  env?: Record<string, EnvVarSpec>
  storage?: { inputs?: StoragePolicy; outputs?: StoragePolicy }
  limits?: { cpu?: string; memory?: string; timeout?: string }
}
```

### Base images

| `base` | What's in it | Tag |
|--------|--------------|-----|
| `glovebox/base` | Node 20 + glovebox user + standard fs layout | `1.0` |
| `glovebox/media` | base + ffmpeg, imagemagick, sox, yt-dlp | `1.4` |
| `glovebox/docs` | base + pandoc, qpdf, pdftk-java, libreoffice headless | `1.2` |
| `glovebox/python` | base + uv + scientific stack | `1.3` |
| `glovebox/browser` | base + Playwright + Chromium | `1.1` |

Images are pulled from `ghcr.io/porkytheblack/glovebox/<name>:<tag>`. Override the registry at build time:

```sh
GLOVEBOX_REGISTRY=registry.my-corp.dev/glovebox glovebox build ./glovebox.ts
```

A custom `base` like `quay.io/me/img:tag` is passed through verbatim — the per-app Dockerfile then provisions the user, layout, and prebuilt `better-sqlite3` itself.

### Filesystem

Defaults — override per-mount via `fs`:

| Name | Path | Writable |
|------|------|----------|
| `work` | `/work` | yes |
| `input` | `/input` | no (mounted RO at runtime) |
| `output` | `/output` | yes (swept on `/clear-workspace`) |

The agent receives an environment block referencing these paths plus a `workspace` skill it can call to list current contents.

### Storage policy DSL

Inputs and outputs are independent ordered lists of `{ use, when }` rules. Earlier rules win. Build them with `rule.*` + `composite`:

```ts
import { rule, composite } from "glovebox"

storage: {
  // Caller can pass URL refs the server fetches; otherwise inline base64.
  inputs: composite([rule.url(), rule.inline()]),

  // Outputs ≤ 1MB ride back inline; everything else is parked on the server
  // for an hour and the client picks it up over the authenticated /files route.
  outputs: composite([
    rule.inline({ below: "1MB" }),
    rule.localServer({ ttl: "1h" }),
  ]),
}
```

| Rule | Options | Notes |
|------|---------|-------|
| `rule.inline({ below?, above? })` | size bounds | base64 in the WS frame; fine for KB-scale |
| `rule.localServer({ ttl?, below?, above? })` | `ttl` defaults to `1h` | server-hosted via `GET /files/:id`; backed by sqlite + sweeper |
| `rule.url({ below?, above? })` | none | inputs only — read-only adapter for caller URLs |
| `rule.s3({ bucket, region?, prefix?, ... })` | bucket required | requires registering an `S3Storage` adapter in your wrap module's `adapters` export (see `glovebox-kit`) |

`composite([])` throws — every policy needs at least one rule. The kit additionally rejects an outputs policy at boot if it has no terminal rule (`always: true` or `default: true`) or if any referenced adapter isn't registered.

A per-prompt override is allowed on the wire (`outputs_policy` on `ClientPromptMessage`) and merges in front of the configured policy — useful when one specific call needs a different parking spot.

### Env vars

Declared variables show up in `.env.example` and are validated on container boot (`required: true` ones throw if unset). The runtime always reads:

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `GLOVEBOX_KEY` | yes | — | Bearer key matching `key_fingerprint` in `glovebox.json` |
| `GLOVEBOX_PORT` | no | `8080` | HTTP/WS listen port |
| `GLOVEBOX_PUBLIC_URL` | no | `http://localhost:<port>` | Used to mint `server` FileRefs the client can reach |

### Limits

Surfaced verbatim through the `environment` skill so the agent can self-throttle. Glovebox does not enforce them — your container runtime does.

## Manifest (`glovebox.json`)

Static description of the deployed app. The kit verifies the bearer matches `key_fingerprint` on boot and rejects mismatches before opening the listener. The manifest is also copied into `server/` so the runtime resolves it via `import.meta.url`.

```ts
interface Manifest {
  name: string
  version: string
  base: string
  fs: Record<string, { path: string; writable: boolean }>
  env: Record<string, ManifestEnvVar>
  limits?: { cpu?: string; memory?: string; timeout?: string }
  key_fingerprint: string                      // sha256 prefix "abcd1234...wxyz"
  storage_policy: { inputs: StoragePolicyEncoded; outputs: StoragePolicyEncoded }
  packages: { apt?: string[]; pip?: string[]; npm?: string[] }
  protocol_version: 1
}
```

## Wire protocol

One WebSocket per client session. Multiple prompts multiplex via `id`. The full type set lives at `glovebox/protocol`. Client → server: `prompt | abort | display_resolve | display_reject | ping`. Server → client: `event | display_push | display_clear | complete | error | pong`.

Files cross the wire as `FileRef` (`inline | url | server | s3 | gcs`) — never raw bytes. The server's storage adapter for the chosen kind is the one and only thing that touches the byte stream.

## CLI

```
glovebox build <entry> [--out <dir>] [--name <name>]
```

`<entry>` is the path to your wrap module. `--out` defaults to `<entry-dir>/dist`. `--name` overrides the manifest name without rebuilding the entry.

## Status

v1. Prompts within a session are serialized — Glove's `PromptMachine` is not safe to invoke concurrently, so the kit chains them. Bearer auth on the WebSocket upgrade; no JWT yet. GCS and Azure storage adapters are deferred to v2 along with multiplexed prompt execution, hot-reload of the wrap module, and the hosted glovebox.dev tier.

## Companion packages

- **[`glovebox-kit`](../glovebox-kit/README.md)** — the in-container runtime that the generated server bundle imports. Register custom storage adapters here.
- **[`glovebox-client`](../glovebox-client/README.md)** — client SDK for talking to a deployed glovebox.

## Documentation

- [Glovebox Guide](https://glove.dterminal.net/docs/glovebox)
- [Getting Started](https://glove.dterminal.net/docs/getting-started)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
