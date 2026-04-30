import { createReadStream } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"

import { verifyBearer } from "../auth"
import type { LocalServerStorage } from "../storage/local-server"

export interface FileRouteDeps {
  storage: LocalServerStorage
  configuredKey: string
}

/**
 * Returns true if the request was handled by this route.
 *
 * Routes:
 *   GET /files/:id              → stream the file
 *   GET /files/:id?consume=1    → stream and delete on success
 */
export async function handleFileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: FileRouteDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost")
  const m = /^\/files\/([A-Za-z0-9-_]+)$/.exec(url.pathname)
  if (!m) return false
  if (req.method !== "GET") {
    res.writeHead(405)
    res.end()
    return true
  }

  const auth = req.headers["authorization"]
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
    res.writeHead(401)
    res.end()
    return true
  }
  const presented = auth.slice("Bearer ".length).trim()
  if (!verifyBearer(presented, deps.configuredKey)) {
    res.writeHead(401)
    res.end()
    return true
  }

  const id = m[1]!
  const row = deps.storage.getRow(id)
  if (!row) {
    res.writeHead(404)
    res.end()
    return true
  }
  const now = Math.floor(Date.now() / 1000)
  if (row.ttl_at < now) {
    res.writeHead(410)
    res.end()
    return true
  }

  const consume = url.searchParams.get("consume") === "1"

  res.writeHead(200, {
    "Content-Type": row.mime,
    "Content-Length": String(row.size),
    "Content-Disposition": `inline; filename="${row.name.replace(/"/g, "")}"`,
  })

  const stream = createReadStream(deps.storage.filePathFor(id))
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve)
    stream.on("error", reject)
    stream.pipe(res)
  })

  if (consume) {
    await deps.storage.deleteRow(id).catch(() => undefined)
  }
  return true
}
