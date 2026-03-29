import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { DB_PATH } from "../../../lib/db/store";
import { existsSync } from "fs";

/**
 * POST /api/inbox/simulate-restock
 * Simulates an inventory restock by resolving all pending "restock_watch" inbox items.
 * In a real system this would be a background job checking inventory levels.
 */
export async function POST() {
  if (!existsSync(DB_PATH)) {
    return NextResponse.json({ resolved: 0 });
  }

  const db = new Database(DB_PATH);
  try {
    const pending = db
      .prepare(
        `SELECT id, request FROM inbox WHERE status = 'pending' AND tag = 'restock_watch'`,
      )
      .all() as Array<{ id: string; request: string }>;

    if (pending.length === 0) {
      return NextResponse.json({ resolved: 0 });
    }

    const update = db.prepare(
      `UPDATE inbox SET status = 'resolved', response = ?, resolved_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    );

    const tx = db.transaction(() => {
      for (const item of pending) {
        update.run(
          `Great news! The item you were watching is back in stock and ready to order.`,
          item.id,
        );
      }
    });

    tx();

    return NextResponse.json({
      resolved: pending.length,
      items: pending.map((p) => ({ id: p.id, request: p.request })),
    });
  } finally {
    db.close();
  }
}
