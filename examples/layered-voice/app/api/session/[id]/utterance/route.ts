import { getSession } from "@/lib/server/session";
import type { SpeakerRole } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit one speaker-tagged utterance. The whole pipeline (monitor → front →
 * worker → relay) runs here; progress streams to the client over the session's
 * SSE channel. We await completion so the turn finishes even on platforms that
 * reclaim the process after the response.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  let body: { speaker?: SpeakerRole; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const speaker = body.speaker;
  const text = (body.text ?? "").toString().trim();
  if (!speaker || !text) {
    return Response.json({ error: "speaker and text are required" }, { status: 400 });
  }

  try {
    await session.handleUtterance(speaker, text);
  } catch {
    // Errors are surfaced as SSE "error" events; the POST still resolves ok.
  }
  return Response.json({ ok: true });
}
