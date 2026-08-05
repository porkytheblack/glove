import { clearAllData } from "@/lib/server/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wipe all persisted data: SQLite rows (sqlite mode) + the metrics file.
 * Live sessions keep their in-memory state — the client starts a fresh session
 * right after calling this (the "Clear data" button does both).
 */
export async function POST() {
  const result = await clearAllData();
  return Response.json({ ok: true, ...result });
}
