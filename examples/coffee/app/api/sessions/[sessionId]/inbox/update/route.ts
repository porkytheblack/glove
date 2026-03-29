import { NextResponse } from "next/server";
import { getStore } from "../../../../../lib/db/store";

// POST /api/sessions/:sessionId/inbox/update — update an inbox item
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const { itemId, updates } = await req.json();
  const store = getStore(sessionId);
  try {
    await store.updateInboxItem(itemId, updates);
    return NextResponse.json({ ok: true });
  } finally {
    store.close();
  }
}
