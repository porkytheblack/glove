import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http"
import path from "node:path"

import type { IGloveRunnable } from "glove-core"
import type {
  ClientMessage,
  FileRef,
  Manifest,
  OutputsPolicyOverride,
  ServerMessage,
  StoragePolicyEncoded,
} from "glovebox-core/protocol"
import type { GloveboxApp } from "glovebox-core"
import { WebSocketServer } from "ws"

import { verifyAgainstManifest, verifyBearer } from "./auth"
import { attachDisplayBridge } from "./display-bridge"
import { handleFileRequest } from "./http/files"
import {
  applyInjections,
  buildEnvironmentBlock,
  type RequestExfilState,
} from "./injection"
import {
  parseSize,
  pickAdapter,
  validateOutputsPolicy,
  type StorageAdapter,
} from "./storage/index"
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
  /** Custom storage adapters, merged into the default registry by `name`. */
  adapters?: Record<string, StorageAdapter>
}

export interface RunningGlovebox {
  http: HttpServer
  wss: WebSocketServer
  close: () => Promise<void>
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

  for (const [name, spec] of Object.entries(manifest.env ?? {})) {
    if (spec.required && process.env[name] === undefined) {
      throw new Error(`Missing required env var: ${name}`)
    }
  }
  if (!verifyAgainstManifest(opts.key, opts.key, manifest.key_fingerprint)) {
    throw new Error("Configured GLOVEBOX_KEY does not match the manifest fingerprint")
  }

  const runnable = opts.app.runnable as IGloveRunnable
  if (!runnable || typeof runnable.processRequest !== "function") {
    throw new Error("App runnable does not look like a Glove runnable (missing processRequest)")
  }

  for (const mount of Object.values(config.fs)) {
    if (mount.writable) await mkdir(mount.path, { recursive: true }).catch(() => undefined)
  }

  // ─── Storage registry ──────────────────────────────────────────────────
  const publicBaseUrl = opts.publicBaseUrl ?? `http://localhost:${opts.port}`
  const localServer = new LocalServerStorage({ publicBaseUrl })
  await localServer.ensureReady()
  localServer.startSweeper()
  const storage: Record<string, StorageAdapter> = {
    inline: new InlineStorage(),
    url: new UrlStorage(),
    localServer,
    ...(opts.adapters ?? {}),
  }
  validateOutputsPolicy(manifest.storage_policy.outputs, storage)

  // ─── Boot-time injections ──────────────────────────────────────────────
  // The exfil state is per-request; we set it up before invoking the agent
  // and read it back after. Because prompts are serialized per session, the
  // single closure reference is safe.
  let currentExfilState: RequestExfilState | undefined
  applyInjections(runnable, config, () => currentExfilState)

  // Prepend a static env block to the existing system prompt — once, at boot.
  // Dynamic per-request data (current /input listing) is reachable via the
  // `workspace` skill the agent can pull on demand.
  if (typeof runnable.getSystemPrompt === "function") {
    const original = runnable.getSystemPrompt()
    const envBlock = buildEnvironmentBlock(config)
    runnable.setSystemPrompt(`${envBlock}\n\n${original}`)
  }

  // ─── HTTP + WS server ──────────────────────────────────────────────────
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
    if (req.url === "/environment") {
      const auth = req.headers["authorization"]
      if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
        res.writeHead(401)
        res.end()
        return
      }
      const presented = auth.slice("Bearer ".length).trim()
      if (!verifyBearer(presented, opts.key)) {
        res.writeHead(401)
        res.end()
        return
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      })
      res.end(JSON.stringify({
        name: manifest.name,
        version: manifest.version,
        base: manifest.base,
        fs: manifest.fs,
        packages: manifest.packages,
        limits: manifest.limits,
        protocol_version: manifest.protocol_version,
      }))
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
    const inflight = new Map<string, AbortController>()
    let promptChain: Promise<unknown> = Promise.resolve()

    const send = (msg: ServerMessage) =>
      new Promise<void>((resolve, reject) => {
        ws.send(JSON.stringify(msg), (err) => (err ? reject(err) : resolve()))
      })

    const subscriber = new WsSubscriber("_session", send)
    runnable.addSubscriber(subscriber)
    const detachDisplay = attachDisplayBridge(runnable.displayManager, subscriber)

    ws.on("message", (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return
      }
      switch (msg.type) {
        case "ping":
          void send({ type: "pong", ts: msg.ts }).catch(() => undefined)
          return
        case "abort": {
          const ac = inflight.get(msg.id)
          if (ac) ac.abort()
          return
        }
        case "display_resolve":
          runnable.displayManager.resolve(msg.slot_id, msg.value)
          return
        case "display_reject":
          runnable.displayManager.reject(msg.slot_id, msg.error)
          return
        case "prompt": {
          // Serialize prompts within a session: the next prompt only starts
          // after the previous chain settles. Glove's PromptMachine + Context
          // are not safe to call concurrently.
          promptChain = promptChain.then(() =>
            handlePrompt(msg, {
              runnable,
              config,
              send,
              subscriber,
              inflight,
              storage,
              outputsPolicy: manifest.storage_policy.outputs,
              setExfilState: (s) => {
                currentExfilState = s
              },
            }).catch((err: unknown) => {
              const error = {
                code: err instanceof Error ? err.name : "error",
                message: err instanceof Error ? err.message : String(err),
              }
              return send({ type: "error", id: msg.id, error }).catch(() => undefined)
            }),
          )
          return
        }
      }
    })

    ws.on("close", () => {
      for (const [, ac] of inflight) ac.abort()
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
  inflight: Map<string, AbortController>
  storage: Record<string, StorageAdapter>
  outputsPolicy: StoragePolicyEncoded
  setExfilState: (s: RequestExfilState | undefined) => void
}

async function handlePrompt(
  msg: {
    type: "prompt"
    id: string
    text: string
    inputs?: Record<string, FileRef>
    outputs_policy?: OutputsPolicyOverride
  },
  deps: PromptDeps,
): Promise<void> {
  // Tag every event from this turn with the prompt's id. Safe because we
  // serialize prompts.
  deps.subscriber.setRequestId(msg.id)
  const exfil: RequestExfilState = { extraOutputs: new Set() }
  deps.setExfilState(exfil)

  const ac = new AbortController()
  deps.inflight.set(msg.id, ac)

  const inputDir = deps.config.fs.input?.path
  const outputDir = deps.config.fs.output?.path

  if (msg.inputs && inputDir) {
    await mkdir(inputDir, { recursive: true }).catch(() => undefined)
    for (const [name, ref] of Object.entries(msg.inputs)) {
      const adapter = pickAdapterForRef(ref, deps.storage)
      const bytes = await adapter.get(ref)
      await writeFile(path.join(inputDir, name), bytes)
    }
  }

  // The env block is set on the system prompt at boot; the prompt text reaches
  // Glove unmodified.
  let completionMessage = ""
  try {
    const result = await deps.runnable.processRequest(msg.text, ac.signal)
    if (result && typeof result === "object" && "messages" in result && Array.isArray(result.messages)) {
      const last = result.messages[result.messages.length - 1]
      if (last) completionMessage = last.text ?? ""
    } else if (result && typeof result === "object" && "text" in result) {
      completionMessage = (result as { text?: string }).text ?? ""
    }
  } finally {
    deps.inflight.delete(msg.id)
    deps.setExfilState(undefined)
  }

  // Resolve the effective outputs policy: per-request override wins.
  const effectivePolicy = applyOutputsOverride(deps.outputsPolicy, msg.outputs_policy)
  validateOutputsPolicy(effectivePolicy, deps.storage)

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
        policy: effectivePolicy,
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
      policy: effectivePolicy,
    })
  }

  await deps.send({
    type: "complete",
    id: msg.id,
    message: completionMessage,
    outputs,
  })
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

/**
 * Apply a per-request override on top of the configured outputs policy.
 * Override rules go to the front so they win.
 */
function applyOutputsOverride(
  base: StoragePolicyEncoded,
  override?: OutputsPolicyOverride,
): StoragePolicyEncoded {
  if (!override) return base
  const extra: StoragePolicyEncoded["rules"] = []
  if (override.s3) {
    extra.push({
      use: { adapter: "s3", options: { bucket: override.s3.bucket, region: override.s3.region, prefix: override.s3.prefix } },
      when: { always: true },
    })
  }
  if (override.inline_below) {
    extra.push({ use: { adapter: "inline" }, when: { sizeBelow: override.inline_below } })
  }
  if (override.server_ttl) {
    extra.push({
      use: { adapter: "localServer", options: { ttl: override.server_ttl } },
      when: { default: true },
    })
  }
  if (extra.length === 0) return base
  // Drop the unused parseSize import suppressor — guard against zero-byte sizes:
  void parseSize
  return { rules: [...extra, ...base.rules] }
}
