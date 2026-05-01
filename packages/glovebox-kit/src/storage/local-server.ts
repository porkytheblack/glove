import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import Database from "better-sqlite3"

import type { FileRef } from "glovebox-core/protocol"

import type { FileMeta, StorageAdapter } from "./index"

export interface LocalServerOptions {
  /** Root directory for stored files. Default `/var/glovebox/files`. */
  dir?: string
  /** SQLite manifest path. Default `<dir>/../files.db`. */
  manifestPath?: string
  /** Public base URL the client uses to GET files. */
  publicBaseUrl: string
  /** Default TTL in seconds for stored files. Default 3600. */
  defaultTtlSeconds?: number
}

interface FileRow {
  id: string
  request_id: string
  name: string
  mime: string
  size: number
  created_at: number
  ttl_at: number
}

function parseDuration(s: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/i.exec(s.trim())
  if (!m) throw new Error(`Invalid duration: ${s}`)
  const n = Number(m[1])
  switch ((m[2] ?? "s").toLowerCase()) {
    case "s":
      return n
    case "m":
      return n * 60
    case "h":
      return n * 3600
    case "d":
      return n * 86400
  }
  return n
}

/**
 * Local-server storage. Files land on disk, ownership tracked in SQLite,
 * served over an HTTP route the WS server hosts.
 */
export class LocalServerStorage implements StorageAdapter {
  readonly name = "localServer"
  private readonly dir: string
  private readonly defaultTtl: number
  private readonly publicBaseUrl: string
  private readonly db: Database.Database
  private sweeperHandle?: ReturnType<typeof setInterval>

  constructor(opts: LocalServerOptions) {
    this.dir = opts.dir ?? "/var/glovebox/files"
    this.defaultTtl = opts.defaultTtlSeconds ?? 3600
    this.publicBaseUrl = opts.publicBaseUrl.replace(/\/$/, "")

    const manifestPath = opts.manifestPath ?? path.join(path.dirname(this.dir), "files.db")
    mkdirSync(path.dirname(manifestPath), { recursive: true })
    this.db = new Database(manifestPath)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id          TEXT PRIMARY KEY,
        request_id  TEXT NOT NULL,
        name        TEXT NOT NULL,
        mime        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        ttl_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_request ON files(request_id);
      CREATE INDEX IF NOT EXISTS idx_files_ttl ON files(ttl_at);
    `)
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  async put(meta: FileMeta, bytes: Uint8Array): Promise<FileRef> {
    await this.ensureReady()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const ttlAt = now + this.defaultTtl
    const filePath = path.join(this.dir, id)
    await writeFile(filePath, bytes, { mode: 0o600 })
    this.db.prepare(`
      INSERT INTO files (id, request_id, name, mime, size, created_at, ttl_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, meta.requestId, meta.name, meta.mime, meta.size, now, ttlAt)

    return {
      kind: "server",
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      id,
      url: `${this.publicBaseUrl}/files/${id}`,
    }
  }

  async get(ref: FileRef): Promise<Uint8Array> {
    if (ref.kind !== "server") {
      throw new Error(`LocalServerStorage cannot get ref of kind ${ref.kind}`)
    }
    const filePath = path.join(this.dir, ref.id)
    const buf = await readFile(filePath)
    return new Uint8Array(buf)
  }

  async release(requestId: string): Promise<void> {
    const rows = this.db.prepare(`SELECT id FROM files WHERE request_id = ?`).all(requestId) as Array<{ id: string }>
    for (const row of rows) {
      try { await unlink(path.join(this.dir, row.id)) } catch { /* already gone */ }
    }
    this.db.prepare(`DELETE FROM files WHERE request_id = ?`).run(requestId)
  }

  /** Read a file row by id — used by the HTTP route for GET /files/:id. */
  getRow(id: string): FileRow | undefined {
    return this.db.prepare(`SELECT * FROM files WHERE id = ?`).get(id) as FileRow | undefined
  }

  /** Delete one file (used by `?consume=1` semantics). */
  async deleteRow(id: string): Promise<void> {
    try { await unlink(path.join(this.dir, id)) } catch { /* already gone */ }
    this.db.prepare(`DELETE FROM files WHERE id = ?`).run(id)
  }

  filePathFor(id: string): string {
    return path.join(this.dir, id)
  }

  startSweeper(intervalMs = 5 * 60 * 1000): void {
    this.sweeperHandle = setInterval(() => {
      void this.sweepExpired()
    }, intervalMs)
    if (typeof this.sweeperHandle.unref === "function") this.sweeperHandle.unref()
  }

  stopSweeper(): void {
    if (this.sweeperHandle) clearInterval(this.sweeperHandle)
    this.sweeperHandle = undefined
  }

  async sweepExpired(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const expired = this.db.prepare(`SELECT id FROM files WHERE ttl_at < ?`).all(now) as Array<{ id: string }>
    for (const row of expired) {
      try { await unlink(path.join(this.dir, row.id)) } catch { /* already gone */ }
    }
    this.db.prepare(`DELETE FROM files WHERE ttl_at < ?`).run(now)
  }
}

export function durationSeconds(s: string): number {
  return parseDuration(s)
}
