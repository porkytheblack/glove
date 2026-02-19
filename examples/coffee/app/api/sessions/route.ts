import { NextResponse } from "next/server";
import { getStore, listAllSessions } from "../../lib/db/store";

// GET /api/sessions — list all sessions
export async function GET() {
  const sessions = listAllSessions();
  return NextResponse.json(sessions);
}

// POST /api/sessions — create a new session, return its id
export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId: string };
  const store = getStore(sessionId);
  store.close();
  return NextResponse.json({ sessionId });
}
