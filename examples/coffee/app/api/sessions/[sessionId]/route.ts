import { NextResponse } from "next/server";
import { getStore } from "../../../lib/db/store";

// PATCH /api/sessions/:sessionId — update session name
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const { name } = (await req.json()) as { name: string };
  const store = getStore(sessionId);
  try {
    store.setName(name);
    return NextResponse.json({ ok: true });
  } finally {
    store.close();
  }
}
