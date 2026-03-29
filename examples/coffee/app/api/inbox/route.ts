import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { DB_PATH } from "../../lib/db/store";
import { existsSync } from "fs";

/**
 * GET /api/inbox
 * Lists all pending inbox items across all sessions.
 * Used by the restock simulator to find items to resolve.
 */
export async function GET() {
  if (!existsSync(DB_PATH)) {
    return NextResponse.json([]);
  }

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const tableExists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='inbox'`,
      )
      .get();

    if (!tableExists) return NextResponse.json([]);

    const rows = db
      .prepare(
        `SELECT id, session_id, tag, request, response, status, blocking, created_at, resolved_at
         FROM inbox WHERE status = 'pending' ORDER BY created_at`,
      )
      .all() as Array<{
      id: string;
      session_id: string;
      tag: string;
      request: string;
      response: string | null;
      status: string;
      blocking: number;
      created_at: string;
      resolved_at: string | null;
    }>;

    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        tag: r.tag,
        request: r.request,
        status: r.status,
        blocking: r.blocking === 1,
        createdAt: r.created_at,
      })),
    );
  } finally {
    db.close();
  }
}
