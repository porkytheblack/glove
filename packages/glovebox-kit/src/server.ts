import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http"
import path from "node:path"

import type { ContentPart, IGloveRunnable } from "glove-core"
import type {
  ClientMessage,
  FileRef,
  Manifest,
  ServerMessage,
  StoragePolicyEncoded,
} from "glovebox/protocol"
import type { GloveboxApp } from "glovebox"
import { WebSocketServer, type WebSocket } from "ws"

import { verifyAgainstManifest, verifyBearer } from "./auth"
import { attachDisplayBridge } from "./display-bridge"
import { handleFileRequest } from "./http/files"
import {
  applyInjections,
  buildEnvironmentBlock,
  REQUEST_EXFIL_STATE,
  type RequestExfilState,
} from "./injection"
import { pickAdapter, type StorageAdapter } from "./storage/index"
import { InlineStorage } from "./storage/inline"
import { LocalServerStorage } from "./storage/local-server"
import { UrlStorage } from "./storage/url"
import { WsSubscriber } from "./ws-subscriber"

export interface StartOptions {
  /** The wrapped app — the developer's `export default glovebox.wrap(...)`. */
  app: GloveboxApp
  /** Listening port. */
  port: number
  /** Auth key (typically from `GLOVEBOX_KEY` env var). */
  key: string
  /** Path to `glovebox.json` (next to the server bundle). */
  manifestPath: string
  /** Public base URL of this server. Used to mint `server` FileRefs. Defaults to `http://localhost:<port>`. */
  publicBaseUrl?: string
}

export interface RunningGlovebox {
  http: HttpServer
  wss: WebSocketServer
  close: () => Promise<void>
}

interface SessionState {
  ws: WebSocket
  inflight: Map<string, AbortController>
}

const MIME_DEFAULT = "application/octet-stream"

function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase()
  switch (ext) {
    case ".json": return "application/json"
    case ".txt": return "text/plain"
    case ".md": return "text/markdown"
    case ".pdf": return "application/pdf"
    case ".png": return "image/png"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".gif": return "image/gif"
    case ".webp": return "image/webp"
    case ".mp4": return "video/mp4"
    case ".webm": return "video/webm"
    case ".mp3": return "audio/mpeg"
    case ".wav": return "audio/wav"
    case ".html": return "text/html"
    case ".csv": return "text/csv"
    default: return MIME_DEFAULT
  }
}

export async function startGlovebox(opts: StartOptions): Promise<RunningGlovebox> {
  const manifest: Manifest = JSON.parse(await readFile(opts.manifestPath, "utf8"))
  const config = opts.app.config

  // Validate env (required keys must be present)
  for (const [name, spec] of Object.entries(manifest.env ?? {})) {
    if (spec.required && process.env[name] === undefined) {
      throw new Error(`Missing required env var: ${name}`)
    }
  }
  // Verify configured key matches manifest fingerprint
  if (!verifyAgainstManifest(opts.key, opts.key, manifest.key_fingerprint)) {
    throw new Error("Configured GLOVEBOX_KEY does not match the manifest fingerprint")
  }

  const runnable = opts.app.runnable as IGloveRunnable
  if (!runnable || typeof runnable.processRequest !== "function") {
    throw new Error("App runnable does not look like a Glove runnable (missing processRequest)")
  }

  // Ensure filesystem mounts exist (writable ones; read-only `/input` is
  // baked into the image but we tolerate missing dirs in dev).
  for (const mount of Object.values(config.fs)) {
    if (mount.writable) await mkdir(mount.path, { recursive: true }).catch(() => undefined)
  }

  // Inject standard skills/hooks/mentions, prepend env block to system prompt.
  let currentExfilState: RequestExfilState | undefined
  applyInjections(runnable, config, () => currentExfilState)

  // Storage registry
  const publicBaseUrl = opts.publicBaseUrl ?? `http://localhost:${opts.port}`
  const localServer = new LocalServerStorage({ publicBaseUrl })
  await localServer.ensureReady()
  localServer.startSweeper()
  const storage: Record<string, StorageAdapter> = {
    inline: new InlineStorage(),
    url: new UrlStorage(),
    localServer,
    // s3: registered by user code if needed
  }

  // HTTP server (handles `/files/:id` and upgrades the WS).
  const http = createServer(async (req, res) => {
    const handled = await handleFileRequest(req, res, {
      storage: localServer,
      configuredKey: opts.key,
    })
    if (handled) return
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, name: manifest.name, version: manifest.version }))
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })

  http.on("upgrade", (req: IncomingMessage, socket, head) => {
    const auth = req.headers["authorization"]
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }
    const presented = auth.slice("Bearer ".length).trim()
    if (!verifyBearer(presented, opts.key)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req)
    })
  })

  wss.on("connection", (ws) => {
    const session: SessionState = { ws, inflight: new Map() }

    const send = (msg: ServerMessage) =>
      new Promise<void>((resolve, reject) => {
        ws.send(JSON.stringify(msg), (err) => (err ? reject(err) : resolve()))
      })

    // Per-session subscriber and display bridge. The subscriber's request id
    // is rewritten per prompt; events are fanned out as they arrive.
    let activeRequestId = "_session"
    const subscriber = new WsSubscriber(activeRequestId, send)
    runnable.addSubscriber(subscriber)
    const detachDisplay = attachDisplayBridge(runnable.displayManager, subscriber)

    ws.on("message", async (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return
      }
      if (msg.type === "ping") {
        await send({ type: "pong", ts: msg.ts }).catch(() => undefined)
        return
      }
      if (msg.type === "abort") {
        const ac = session.inflight.get(msg.id)
        if (ac) ac.abort()
        return
      }
      if (msg.type === "display_resolve") {
        runnable.displayManager.resolve(msg.slot_id, msg.value)
        return
      }
      if (msg.type === "display_reject") {
        runnable.displayManager.reject(msg.slot_id, msg.error)
        return
      }
      if (msg.type === "prompt") {
        await handlePrompt(msg, {
          runnable,
          config: config,
          send,
          subscriber,
          session,
          storage,
          inputsPolicy: manifest.storage_policy.inputs,
          outputsPolicy: manifest.storage_policy.outputs,
          setActiveRequestId: (id) => {
            activeRequestId = id
            subscriber.setRequestId(id)
          },
          setExfilState: (s) => {
            currentExfilState = s
          },
        }).catch((err: unknown) => {
          const error = {
            code: err instanceof Error ? err.name : "error",
            message: err instanceof Error ? err.message : String(err),
          }
          void send({ type: "error", id: msg.id, error }).catch(() => undefined)
        })
      }
    })

    ws.on("close", () => {
      for (const [, ac] of session.inflight) ac.abort()
      detachDisplay()
      subscriber.close()
      runnable.removeSubscriber(subscriber)
    })
  })

  await new Promise<void>((resolve) => http.listen(opts.port, resolve))

  return {
    http,
    wss,
    close: async () => {
      localServer.stopSweeper()
      wss.close()
      await new Promise<void>((resolve, reject) => http.close((err) => (err ? reject(err) : resolve())))
    },
  }
}

interface PromptDeps {
  runnable: IGloveRunnable
  config: GloveboxApp["config"]
  send: (msg: ServerMessage) => Promise<void>
  subscriber: WsSubscriber
  session: SessionState
  storage: Record<string, StorageAdapter>
  inputsPolicy: StoragePolicyEncoded
  outputsPolicy: StoragePolicyEncoded
  setActiveRequestId: (id: string) => void
  setExfilState: (s: RequestExfilState | undefined) => void
}

async function handlePrompt(
  msg: { type: "prompt"; id: string; text: string; inputs?: Record<string, FileRef> },
  deps: PromptDeps,
): Promise<void> {
  deps.setActiveRequestId(msg.id)
  const exfil: RequestExfilState = { extraOutputs: new Set() }
  deps.setExfilState(exfil)
  const ac = new AbortController()
  deps.session.inflight.set(msg.id, ac)
  REQUEST_EXFIL_STATE.set({} as object, exfil) // future per-context wiring

  const inputDir = deps.config.fs.input?.path
  const outputDir = deps.config.fs.output?.path

  // Resolve inputs onto disk
  if (msg.inputs && inputDir) {
    await mkdir(inputDir, { recursive: true }).catch(() => undefined)
    for (const [name, ref] of Object.entries(msg.inputs)) {
      const adapter = pickAdapterForRef(ref, deps.storage)
      const bytes = await adapter.get(ref)
      await writeFile(path.join(inputDir, name), bytes)
    }
  }

  const text = msg.text

  // Prepend the env block to the agent's system prompt for this turn. We use
  // a content-part array so the env block stays separate from the prompt.
  const envBlock = buildEnvironmentBlock(deps.config, msg.inputs)
  const composed: ContentPart[] = [
    { type: "text", text: envBlock },
    { type: "text", text },
  ]

  let completionMessage = ""
  try {
    const result = await deps.runnable.processRequest(composed, ac.signal)
    if (result && typeof result === "object" && "messages" in result && Array.isArray(result.messages)) {
      const last = result.messages[result.messages.length - 1]
      if (last) completionMessage = last.text ?? ""
    } else if (result && typeof result === "object" && "text" in result) {
      completionMessage = (result as { text?: string }).text ?? ""
    }
  } catch (err) {
    deps.session.inflight.delete(msg.id)
    deps.setExfilState(undefined)
    throw err
  }

  // Enumerate outputs
  const outputs: Record<string, FileRef> = {}
  if (outputDir) {
    const files = await readdir(outputDir).catch(() => [] as string[])
    for (const name of files) {
      const full = path.join(outputDir, name)
      const s = await stat(full).catch(() => null)
      if (!s || !s.isFile()) continue
      outputs[name] = await uploadOutput({
        full,
        name,
        size: s.size,
        requestId: msg.id,
        storage: deps.storage,
        policy: deps.outputsPolicy,
      })
    }
  }
  for (const extra of exfil.extraOutputs) {
    const name = path.basename(extra)
    if (outputs[name]) continue
    const s = await stat(extra).catch(() => null)
    if (!s || !s.isFile()) continue
    outputs[name] = await uploadOutput({
      full: extra,
      name,
      size: s.size,
      requestId: msg.id,
      storage: deps.storage,
      policy: deps.outputsPolicy,
    })
  }

  await deps.send({
    type: "complete",
    id: msg.id,
    message: completionMessage,
    outputs,
  })

  deps.session.inflight.delete(msg.id)
  deps.setExfilState(undefined)
}

function pickAdapterForRef(ref: FileRef, registry: Record<string, StorageAdapter>): StorageAdapter {
  switch (ref.kind) {
    case "inline": return registry.inline!
    case "url": return registry.url!
    case "server": return registry.localServer!
    case "s3": {
      const a = registry.s3
      if (!a) throw new Error("Received s3 FileRef but no s3 storage adapter is registered")
      return a
    }
    case "gcs": {
      const a = registry.gcs
      if (!a) throw new Error("Received gcs FileRef but no gcs storage adapter is registered")
      return a
    }
  }
}

async function uploadOutput(args: {
  full: string
  name: string
  size: number
  requestId: string
  storage: Record<string, StorageAdapter>
  policy: StoragePolicyEncoded
}): Promise<FileRef> {
  const adapter = pickAdapter(args.policy, { size: args.size }, args.storage)
  const bytes = await readFile(args.full)
  return adapter.put(
    {
      name: args.name,
      mime: guessMime(args.name),
      size: args.size,
      requestId: args.requestId,
    },
    new Uint8Array(bytes),
  )
}
