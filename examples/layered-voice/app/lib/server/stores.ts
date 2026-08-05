// ─────────────────────────────────────────────────────────────────────────────
// Store factory + data clearing (PGlite — embedded Postgres, zero native deps).
//
// The MESH needs no database: MeshNetwork/InMemoryMeshAdapter is an in-process
// bus, and both agents live in this Node process. What a store persists is each
// agent's OWN state — messages and the inbox, which is where all mesh state
// actually lives (pending `mesh:waiting` items, worker replies).
//
// Modes (VOICE_PERSIST):
//   "memory" (default) — MemoryStore; everything vanishes on restart.
//   "pglite"           — a custom StoreAdapter over @electric-sql/pglite
//                        (Postgres compiled to WASM — no native bindings).
//                        Both agents share ONE data directory
//                        (./voice-agents-db), scoped by session/role ids, so
//                        transcripts + mesh inbox traffic survive restarts.
//
// Clearing: the "Clear data" button (→ POST /api/admin/clear → clearAllData),
// `pnpm clear` with the server stopped, or just delete the voice-agents-db dir.
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  MemoryStore,
  type InboxItem,
  type Message,
  type StoreAdapter,
  type TokenConsumptionCounter,
} from "glove-core";
import { metricsFilePath } from "./metrics";

export type PersistMode = "memory" | "pglite";

export const PERSIST: PersistMode =
  process.env.VOICE_PERSIST === "pglite" ? "pglite" : "memory";

export function dbDirPath(): string {
  const dir = process.env.VOICE_DB_DIR || "voice-agents-db";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

// ── shared PGlite instance (one per process; survives Next.js HMR) ───────────
const g = globalThis as unknown as { __voicePglite?: Promise<PGlite> };

function getDb(): Promise<PGlite> {
  if (!g.__voicePglite) {
    g.__voicePglite = (async () => {
      const db = new PGlite(dbDirPath());
      await db.waitReady;
      await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          seq BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          payload JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
        CREATE TABLE IF NOT EXISTS counters (
          session_id TEXT PRIMARY KEY,
          tokens_in INTEGER NOT NULL DEFAULT 0,
          tokens_out INTEGER NOT NULL DEFAULT 0,
          cache_creation INTEGER NOT NULL DEFAULT 0,
          cache_read INTEGER NOT NULL DEFAULT 0,
          turns INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS inbox (
          id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          request TEXT NOT NULL,
          response TEXT,
          status TEXT NOT NULL,
          blocking BOOLEAN NOT NULL,
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          PRIMARY KEY (session_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_session ON inbox(session_id, status);
      `);
      return db;
    })();
  }
  return g.__voicePglite;
}

// ── the PGlite-backed StoreAdapter ───────────────────────────────────────────
// Implements the required surface (messages + counters) and the inbox methods
// mountMesh needs. Tasks/permissions/sub-stores are omitted — the framework
// silently disables those features when a store doesn't implement them.
class PgliteStore implements StoreAdapter {
  constructor(public identifier: string) {}

  async getMessages(): Promise<Message[]> {
    const db = await getDb();
    const r = await db.query<{ payload: Message }>(
      `SELECT payload FROM messages WHERE session_id = $1 ORDER BY seq`,
      [this.identifier],
    );
    return r.rows.map((row) => row.payload);
  }

  async appendMessages(msgs: Message[]): Promise<void> {
    if (!msgs.length) return;
    const db = await getDb();
    for (const m of msgs) {
      await db.query(`INSERT INTO messages (session_id, payload) VALUES ($1, $2::jsonb)`, [
        this.identifier,
        JSON.stringify(m),
      ]);
    }
  }

  private async counters() {
    const db = await getDb();
    const r = await db.query<{
      tokens_in: number;
      tokens_out: number;
      cache_creation: number;
      cache_read: number;
      turns: number;
    }>(`SELECT tokens_in, tokens_out, cache_creation, cache_read, turns FROM counters WHERE session_id = $1`, [
      this.identifier,
    ]);
    return r.rows[0] ?? { tokens_in: 0, tokens_out: 0, cache_creation: 0, cache_read: 0, turns: 0 };
  }

  async getTokenCount(): Promise<number> {
    const c = await this.counters();
    return c.tokens_in + c.tokens_out;
  }

  async addTokens(args: TokenConsumptionCounter): Promise<void> {
    const db = await getDb();
    await db.query(
      `INSERT INTO counters (session_id, tokens_in, tokens_out, cache_creation, cache_read)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET
         tokens_in = counters.tokens_in + EXCLUDED.tokens_in,
         tokens_out = counters.tokens_out + EXCLUDED.tokens_out,
         cache_creation = counters.cache_creation + EXCLUDED.cache_creation,
         cache_read = counters.cache_read + EXCLUDED.cache_read`,
      [
        this.identifier,
        args.tokens_in ?? 0,
        args.tokens_out ?? 0,
        args.cache_creation_input_tokens ?? 0,
        args.cache_read_input_tokens ?? 0,
      ],
    );
  }

  async getTokenConsumption(): Promise<TokenConsumptionCounter> {
    const c = await this.counters();
    return {
      tokens_in: c.tokens_in,
      tokens_out: c.tokens_out,
      cache_creation_input_tokens: c.cache_creation,
      cache_read_input_tokens: c.cache_read,
    };
  }

  async getTurnCount(): Promise<number> {
    return (await this.counters()).turns;
  }

  async incrementTurn(): Promise<void> {
    const db = await getDb();
    await db.query(
      `INSERT INTO counters (session_id, turns) VALUES ($1, 1)
       ON CONFLICT (session_id) DO UPDATE SET turns = counters.turns + 1`,
      [this.identifier],
    );
  }

  async resetCounters(): Promise<void> {
    const db = await getDb();
    await db.query(
      `UPDATE counters SET tokens_in = 0, tokens_out = 0, cache_creation = 0, cache_read = 0, turns = 0
       WHERE session_id = $1`,
      [this.identifier],
    );
  }

  // ── inbox — required by mountMesh; this is where mesh state persists ───────
  private rowToItem(r: {
    id: string;
    tag: string;
    request: string;
    response: string | null;
    status: string;
    blocking: boolean;
    created_at: string;
    resolved_at: string | null;
  }): InboxItem {
    return {
      id: r.id,
      tag: r.tag,
      request: r.request,
      response: r.response,
      status: r.status as InboxItem["status"],
      blocking: r.blocking,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
    };
  }

  async getInboxItems(): Promise<InboxItem[]> {
    const db = await getDb();
    const r = await db.query<Parameters<PgliteStore["rowToItem"]>[0]>(
      `SELECT id, tag, request, response, status, blocking, created_at, resolved_at
       FROM inbox WHERE session_id = $1 ORDER BY created_at`,
      [this.identifier],
    );
    return r.rows.map((row) => this.rowToItem(row));
  }

  async addInboxItem(item: InboxItem): Promise<void> {
    const db = await getDb();
    await db.query(
      `INSERT INTO inbox (id, session_id, tag, request, response, status, blocking, created_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        item.id,
        this.identifier,
        item.tag,
        item.request,
        item.response,
        item.status,
        item.blocking,
        item.created_at,
        item.resolved_at,
      ],
    );
  }

  async updateInboxItem(
    itemId: string,
    updates: Partial<Pick<InboxItem, "status" | "response" | "resolved_at">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (updates.status !== undefined) {
      sets.push(`status = $${n++}`);
      values.push(updates.status);
    }
    if (updates.response !== undefined) {
      sets.push(`response = $${n++}`);
      values.push(updates.response);
    }
    if (updates.resolved_at !== undefined) {
      sets.push(`resolved_at = $${n++}`);
      values.push(updates.resolved_at);
    }
    if (!sets.length) return;
    const db = await getDb();
    await db.query(
      `UPDATE inbox SET ${sets.join(", ")} WHERE session_id = $${n++} AND id = $${n}`,
      [...values, this.identifier, itemId],
    );
  }

  async getResolvedInboxItems(): Promise<InboxItem[]> {
    const db = await getDb();
    const r = await db.query<Parameters<PgliteStore["rowToItem"]>[0]>(
      `SELECT id, tag, request, response, status, blocking, created_at, resolved_at
       FROM inbox WHERE session_id = $1 AND status = 'resolved' ORDER BY created_at`,
      [this.identifier],
    );
    return r.rows.map((row) => this.rowToItem(row));
  }
}

// ── factory + clearing ───────────────────────────────────────────────────────

/**
 * Build the store for one agent. `scopedId` should be unique per session and
 * role (e.g. "sess_abc_front") — in pglite mode it becomes the row scope inside
 * the shared data directory.
 */
export function createAgentStore(scopedId: string): StoreAdapter {
  if (PERSIST === "pglite") return new PgliteStore(scopedId);
  return new MemoryStore(scopedId);
}

/**
 * Wipe all persisted data in place: every row in the PGlite store (safe while
 * the server runs — live sessions should be reset right after) and the metrics
 * file. Returns what was actually cleared.
 */
export async function clearAllData(): Promise<{ cleared: string[]; mode: PersistMode }> {
  const cleared: string[] = [];

  if (PERSIST === "pglite") {
    try {
      const db = await getDb();
      await db.exec(`DELETE FROM messages; DELETE FROM inbox; DELETE FROM counters;`);
      cleared.push("database");
    } catch {
      /* db never initialized — nothing to clear */
    }
  }

  if (existsSync(metricsFilePath())) {
    try {
      await writeFile(metricsFilePath(), "", "utf8");
      cleared.push("metrics");
    } catch {
      /* leave it */
    }
  }

  return { cleared, mode: PERSIST };
}
