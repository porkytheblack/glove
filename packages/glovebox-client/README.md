# glovebox-client

Client SDK for talking to a deployed [Glovebox](https://github.com/porkytheblack/glove) server. One WebSocket per session, multiple prompts multiplexed. Streams subscriber events and display slot pushes; resolves with the final assistant message and an outputs map of `FileRef`s the client can read back through the configured storage.

## Install

```sh
pnpm add glovebox-client
```

Works in Node (uses `ws`) and the browser (uses the global `WebSocket`). The wire format and auth are identical.

## Usage

### Connecting

```ts
import { GloveboxClient } from "glovebox-client"

const client = GloveboxClient.make({
  endpoints: {
    media: { url: "wss://media.example.com/", key: process.env.GLOVEBOX_MEDIA_KEY! },
    docs:  { url: "wss://docs.example.com/",  key: process.env.GLOVEBOX_DOCS_KEY!  },
  },
})

const media = client.box("media")
```

`client.box(name)` lazily opens a connection on the first prompt and caches the `Box` afterward. The bearer key from the endpoint config is sent as `Authorization: Bearer ...` on the WS upgrade and on every subsequent HTTP request the SDK makes (`/environment`, `/files/:id`).

### Prompting

```ts
import { readFile } from "node:fs/promises"

const result = media.prompt("Trim the first 30 seconds off in.mp4 and write trimmed.mp4.", {
  files: {
    "in.mp4": { mime: "video/mp4", bytes: await readFile("./in.mp4") },
  },
})

for await (const ev of result.events) {
  if (ev.event_type === "text_delta") process.stdout.write((ev.data as { text: string }).text)
}

const message = await result.message
const outputs = await result.outputs
const trimmed = await result.read("trimmed.mp4")
await writeFile("./trimmed.mp4", trimmed)
```

`prompt(text, opts)` returns a `PromptResult` synchronously — the call doesn't await the round-trip. The four async iterables / promises on the result fan out as the server sends frames:

| Member | Type | Settles when |
|--------|------|--------------|
| `events` | `AsyncIterable<SubscriberEvent>` | Closed at `complete` / `error`. |
| `display` | `AsyncIterable<DisplayEvent>` | Closed at `complete` / `error`. Display events are session-scoped on the server, so they fan out to every active prompt. |
| `message` | `Promise<string>` | Final assistant text from the `complete` frame. |
| `outputs` | `Promise<Record<string, FileRef>>` | Outputs map from the `complete` frame. |
| `read(name)` | `Promise<Uint8Array>` | Awaits `outputs`, looks up the named ref, fetches it through the configured `ClientStorage`. |
| `resolve(slot_id, value)` | `void` | Sends a display resolution back to the server. |
| `reject(slot_id, error)` | `void` | Sends a display rejection back. |
| `abort()` | `void` | Sends `{ type: "abort", id }`. |

### Display slots

When a tool inside the agent calls `display.pushAndWait(...)`, the server emits a `display_push`. Route slot pushes by `slot.renderer`, render the input, and call `result.resolve(slot.id, value)` once the user submits.

```ts
const result = media.prompt("Pick a frame to use as the thumbnail.")

for await (const ev of result.display) {
  if (ev.type === "push" && ev.slot) {
    const slot = ev.slot
    if (slot.renderer === "frame_picker") {
      const choice = await renderFramePicker(slot.input)
      result.resolve(slot.id, choice)
    }
  } else if (ev.type === "clear") {
    clearSlot(ev.slot_id!)
  }
}
```

### Reading the environment

```ts
const env = await media.environment()
// env.fs.input.path === "/input"
// env.packages.apt?.includes("ffmpeg")
```

Cached after the first call. Useful when the same client holds many endpoints and routes prompts based on declared capabilities. Backed by `GET /environment` on the server.

### Send-side errors

Outgoing frames (`prompt`, `abort`, `display_resolve`, `display_reject`) are dispatched through `void this.send(...)`. Failures there are surfaced via:

```ts
const off = media.onSendError((err) => {
  console.error("[media] send failed:", err)
})
// later
off()
```

If no listener is registered, the SDK warns to `console.warn` so the failure doesn't disappear silently.

### Lifecycle

```ts
await media.close()           // closes one box
await client.close()          // closes every cached box
```

Closing rejects every in-flight prompt's `message` and `outputs` and closes the corresponding event/display iterators. The connection is otherwise managed lazily — `prompt()` re-opens after `close()` only if you reach back through `client.box(...)` for a fresh `Box`.

## Custom storage

`DefaultClientStorage` puts files inline (base64) and reads `inline | url | server` refs. That's enough for a lot of agents — tens of MB ride fine — but exceeds what you want over a single WS frame at some point.

Provide a `ClientStorage` to split big inputs out. The contract is two methods:

```ts
interface ClientStorage {
  put(name: string, mime: string, bytes: Uint8Array): Promise<FileRef>
  get(ref: FileRef, opts?: { bearer?: string }): Promise<Uint8Array>
}
```

Example: pre-sign an S3 URL on your backend, hand the `s3` ref to the server.

```ts
import type { ClientStorage } from "glovebox-client"
import type { FileRef } from "glovebox-client"

class S3UploadingStorage implements ClientStorage {
  async put(name, mime, bytes): Promise<FileRef> {
    const { bucket, key, putUrl } = await fetch("/api/sign-upload", {
      method: "POST",
      body: JSON.stringify({ name, mime, size: bytes.length }),
    }).then((r) => r.json())
    await fetch(putUrl, { method: "PUT", body: bytes, headers: { "Content-Type": mime } })
    return { kind: "s3", name, mime, bucket, key }
  }

  async get(ref: FileRef, opts) {
    if (ref.kind === "s3") {
      const { getUrl } = await fetch("/api/sign-download", {
        method: "POST",
        body: JSON.stringify({ bucket: ref.bucket, key: ref.key }),
      }).then((r) => r.json())
      return new Uint8Array(await fetch(getUrl).then((r) => r.arrayBuffer()))
    }
    return new DefaultClientStorage().get(ref, opts)
  }
}

const client = GloveboxClient.make({
  endpoints: { media: { url, key } },
  storage: new S3UploadingStorage(),
})
```

The same storage is used for outputs: `result.read(name)` calls `storage.get(ref, { bearer })`, so `s3` refs returned by the server flow through your custom adapter too. The bearer is forwarded only for `server`-kind refs (the kit's authenticated `/files/:id` route).

`PromptOptions.inputs` lets you pass pre-built `FileRef`s alongside (or instead of) raw `files` — handy when the bytes already live somewhere the server can read directly.

## Errors

Server `error` frames reject `result.message` and `result.outputs` with an `Error` carrying the server-supplied `code` (assignable as `(err as Error & { code: string }).code`). The connection itself is preserved — only the failing prompt is dropped. A WS close drops every in-flight prompt with `Error("Connection closed")`. There is no automatic reconnect in v1; a fresh prompt on a closed `Box` throws.

## Public surface

```ts
import {
  GloveboxClient,
  Box,
  DefaultClientStorage,
  type GloveboxClientOptions,
  type BoxEndpoint,
  type BoxOptions,
  type PromptOptions,
  type PromptResult,
  type SubscriberEvent,
  type DisplayEvent,
  type BoxEnvironment,
  type ClientStorage,
  type DefaultClientStorageOptions,
  type FileRef,
  type SubscriberEventType,
  type WireSlot,
} from "glovebox-client"
```

## Status

v1. The wire protocol is `protocol_version: 1`. Connections are bearer-authed and prompts within a session run sequentially on the server. There is no client-side reconnect / resume — when the socket drops, in-flight prompts reject. JWT auth, multiplexed execution, and a hosted glovebox.dev tier are deferred to v2.

## Companion packages

- **[`glovebox`](../glovebox/README.md)** — authoring kit + `glovebox build` CLI.
- **[`glovebox-kit`](../glovebox-kit/README.md)** — in-container runtime.

## Documentation

- [Glovebox Guide](https://glove.dterminal.net/docs/glovebox)
- [Full Documentation](https://glove.dterminal.net)

## License

MIT
