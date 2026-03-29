import { NextResponse } from "next/server";
import { SqliteStore } from "glove-core";
import { DB_PATH } from "../../../lib/db/store";

/**
 * POST /api/inbox/resolve
 * External endpoint for resolving inbox items (e.g., restock notifications).
 *
 * Body: { itemId: string, response: string }
 */
export async function POST(req: Request) {
  const { itemId, response } = await req.json();

  if (!itemId || !response) {
    return NextResponse.json(
      { error: "itemId and response are required" },
      { status: 400 },
    );
  }

  const resolved = SqliteStore.resolveInboxItem(DB_PATH, itemId, response);

  if (!resolved) {
    return NextResponse.json(
      { error: "Item not found or already resolved" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, itemId });
}
