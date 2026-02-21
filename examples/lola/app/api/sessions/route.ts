import { NextResponse } from "next/server";
import { getStore, listAllSessions } from "../../lib/db/store";

export async function GET() {
  const sessions = listAllSessions();
  return NextResponse.json(sessions);
}

export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId: string };
  const store = getStore(sessionId);
  store.close();
  return NextResponse.json({ sessionId });
}
