# glovebox-kit

In-container runtime for [Glovebox](https://github.com/porkytheblack/glove). Hosts a wrapped Glove agent behind a single authenticated WebSocket endpoint, plus an HTTP `/files` route for server-parked outputs.

> **Most users do not import this package directly.** `glovebox build` generates a server entry that already calls `startGlovebox()`, links the manifest, and registers the bundled adapters. You only reach for `glovebox-kit` when you need to register an extra `StorageAdapter` (S3, your own URL signer, ...) or hand-roll the server entry for an unusual deployment.

## Install

```sh
pnpm add glovebox-kit
```

`glovebox-kit` is already pulled in transitively when you depend on `glovebox`. Adding it explicitly is only useful when you import an adapter from your wrap module.

## What runs inside the container

When the bundled server boots:

1. Reads `glovebox.json` next to `server/index.js`. Verifies `GLOVEBOX_KEY` against `key_fingerprint`. Throws on every required env var that isn't set.
2. Creates writable mounts (`/work`, `/output`, ...) if missing.
3. Builds the storage registry: `inline`, `url`, `localServer` are always present; anything from your wrap module's `adapters` export is merged on top.
4. Validates the configured `outputs` storage policy against the registry — every referenced adapter must exist and be writable. Boot fails fast otherwise.
5. Calls `applyInjections(runnable, config, ...)` to fold the `environment` and `workspace` skills, the `/output` hook, and the `/clear-workspace` hook onto the agent.
6. Prepends a static environment preamble to the agent's existing system prompt via `runnable.setSystemPrompt(envBlock + "\n\n" + runnable.getSystemPrompt())`.
7. Starts an HTTP server on `GLOVEBOX_PORT` (default `8080`). Routes: `/health`, `/environment`, `/files/:id`, plus a WebSocket upgrade on `/`.

Per WS connection, the kit attaches a `WsSubscriber` to fan agent events out as wire messages and an `attachDisplayBridge` so display slot pushes/clears reach the client.

## Registering adapters

The standard case: your wrap module declares `adapters` alongside the default export. The build CLI bundles that export, and the generated server entry passes it as `startGlovebox({ adapters: ... })`.

```ts
// glovebox.ts
import { S3Storage } from "glovebox-kit"
import { glovebox, rule, composite } from "glovebox"
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"

const s3 = new S3Client({ region: process.env.AWS_REGION })

export const adapters = {
  s3: new S3Storage({
    bucket: "my-outputs",
    region: process.env.AWS_REGION,
    prefix: "trimmer",
    async uploadObject({ bucket, key, body, contentType }) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body, ContentType: contentType,
      }))
    },
    async downloadObject({ bucket, key }) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const chunks: Uint8Array[] = []
      for await (const chunk of out.Body as AsyncIterable<Uint8Array>) chunks.push(chunk)
      return Buffer.concat(chunks)
    },
  }),
}

export default glovebox.wrap(agent, {
  // ... base, packages, env, ...
  storage: {
    outputs: composite([
      rule.inline({ below: "1MB" }),
      rule.s3({ bucket: "my-outputs", prefix: "trimmer" }),
    ]),
  },
})
```

The same registry handles inputs: a `kind: "s3"` `FileRef` that arrives in a `prompt` message is downloaded via your `S3Storage.get()` and copied into `/input`.

## Bundled storage adapters

| Adapter | Reads | Writes | When to use |
|---------|-------|--------|-------------|
| `InlineStorage` | yes | yes | Small payloads (KB-scale). Bytes ride base64 in the WS frame. |
| `UrlStorage` | yes | no | Inputs supplied as a fetchable URL the server retrieves. Read-only — never targeted by an outputs policy. |
| `LocalServerStorage` | yes | yes | Outputs the client retrieves via `GET /files/:id`. Backed by SQLite + a TTL sweeper. Default 1h TTL. |
| `S3Storage` | yes | yes | Anything bigger than what you want to ship through the server's bandwidth. Caller supplies `uploadObject` / `downloadObject` so the kit doesn't hard-depend on `@aws-sdk/client-s3`. |

`pickAdapter(policy, { size }, registry)` is the resolver the server uses to choose an adapter for a given output. It walks `policy.rules` in order, applying `sizeAbove` / `sizeBelow` / `always` / `default`. Exposed for unit tests and for advanced users who want to mirror the server's selection logic outside the kit.

## Auto-injected agent surface

`applyInjections(runnable, config, resolveExfilState)` folds four pieces onto the runnable. `glovebox build`'s server entry calls it for you.

| Surface | Kind | Purpose |
|---------|------|---------|
| `environment` | skill | Returns the manifest's name, version, base, fs layout, packages, limits as JSON. |
| `workspace` | skill | Lists current contents of every fs mount (`/work`, `/input`, `/output`, ...). |
| `/output <path>` | hook | Marks a path outside `/output` for exfiltration in the current request's response. The kit uploads it via the same outputs policy. |
| `/clear-workspace` | hook | Empties `/work` between turns. |

`buildEnvironmentBlock(config)` produces the static preamble that gets prepended to the agent's system prompt at boot. Per-request data (the live `/input` listing) is *not* baked in — the agent calls the `workspace` skill on demand.

## Hand-rolling a server entry

The generated entry is small enough to write by hand if you need something the build doesn't emit (extra HTTP routes, custom upgrade auth, ...). The minimum:

```ts
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { startGlovebox } from "glovebox-kit"
import app, { adapters } from "./glovebox.js"

const here = path.dirname(fileURLToPath(import.meta.url))

await startGlovebox({
  app,
  port: Number(process.env.GLOVEBOX_PORT ?? 8080),
  key: process.env.GLOVEBOX_KEY!,
  manifestPath: path.join(here, "glovebox.json"),
  publicBaseUrl: process.env.GLOVEBOX_PUBLIC_URL,
  adapters,
})
```

`startGlovebox` returns a `RunningGlovebox` (`{ http, wss, close }`) so test harnesses can shut down cleanly.

## Environment

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `GLOVEBOX_KEY` | yes | — | Bearer key. Verified against `key_fingerprint` in the manifest before the listener opens. |
| `GLOVEBOX_PORT` | no | `8080` | HTTP/WS listen port. |
| `GLOVEBOX_PUBLIC_URL` | no | `http://localhost:<port>` | Used to mint the `url` field on `server` `FileRef`s. Set this when the container is reachable through a public hostname so clients can fetch outputs without rewriting URLs. |

Plus everything declared in your wrap config's `env` map — those are validated on boot.

## HTTP endpoints

| Method | Path | Auth | Body |
|--------|------|------|------|
| `GET` | `/health` | none | `{ ok: true, name, version }` |
| `GET` | `/environment` | bearer | Manifest's name/version/base/fs/packages/limits/protocol_version |
| `GET` | `/files/:id` | bearer | Streams a server-parked file. `?consume=1` deletes on success. Returns `410` after TTL. |
| `GET` | `/` (Upgrade) | bearer | WebSocket upgrade. Multiplexed prompt protocol — see `glovebox/protocol`. |

Every authenticated route uses constant-time comparison (`verifyBearer`) against `GLOVEBOX_KEY`. The bearer is read from the `Authorization: Bearer ...` header on every request, including the WS upgrade.

## Public surface

```ts
import {
  startGlovebox,
  // Storage
  InlineStorage,
  UrlStorage,
  LocalServerStorage,
  S3Storage,
  pickAdapter,
  // Lower-level wiring (rarely needed)
  WsSubscriber,
  attachDisplayBridge,
  applyInjections,
  buildEnvironmentBlock,
  type StorageAdapter,
  type FileMeta,
  type RequestExfilState,
  type StartOptions,
  type RunningGlovebox,
  type S3AdapterOptions,
} from "glovebox-kit"
```

`WsSubscriber`, `attachDisplayBridge`, `applyInjections`, `buildEnvironmentBlock` are exposed for tests and for users replacing the server entry — production wrap modules do not import them.

## Status

v1. Prompts within a single session run sequentially: the WS handler chains them on a `Promise` because Glove's `PromptMachine` and `Context` aren't safe to invoke concurrently. Bearer auth on every route — JWT, GCS / Azure adapters, hot-reload of the wrap module, partial-output success mode, and base-image-bundled subagent mentions are deferred to v2.

## Companion packages

- **[`glovebox`](../glovebox/README.md)** — authoring kit + `glovebox build` CLI.
- **[`glovebox-client`](../glovebox-client/README.md)** — client SDK.

## Documentation

- [Glovebox Guide](https://glove.dterminal.net/docs/glovebox)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
