import { NextResponse } from "next/server";
import { getStore } from "../../../../lib/db/store";

// GET /api/sessions/:sessionId/inbox
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const store = getStore(sessionId);
  try {
    const items = await store.getInboxItems();
    return NextResponse.json(items);
  } finally {
    store.close();
  }
}

// POST /api/sessions/:sessionId/inbox — add inbox item
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const { item } = await req.json();
  const store = getStore(sessionId);
  try {
    await store.addInboxItem(item);
    return NextResponse.json({ ok: true });
  } finally {
    store.close();
  }
}
