import { NextResponse } from "next/server";
import { getStore } from "../../../../../lib/db/store";

// GET /api/sessions/:sessionId/inbox/resolved
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const store = getStore(sessionId);
  try {
    const items = await store.getResolvedInboxItems();
    return NextResponse.json(items);
  } finally {
    store.close();
  }
}
