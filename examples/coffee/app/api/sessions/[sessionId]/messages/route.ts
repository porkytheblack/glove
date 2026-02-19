import { NextResponse } from "next/server";
import { getStore } from "../../../../lib/db/store";

// GET /api/sessions/:sessionId/messages
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const store = getStore(sessionId);
  try {
    const messages = await store.getMessages();
    return NextResponse.json(messages);
  } finally {
    store.close();
  }
}

// POST /api/sessions/:sessionId/messages — append messages
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const { messages } = (await req.json()) as { messages: unknown[] };
  const store = getStore(sessionId);
  try {
    await store.appendMessages(messages as any);
    return NextResponse.json({ ok: true });
  } finally {
    store.close();
  }
}
