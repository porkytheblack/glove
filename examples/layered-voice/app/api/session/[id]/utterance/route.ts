import { getSession } from "@/lib/server/session";
import type { SpeakerRole } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Submit one speaker-tagged utterance. This resolves when NOVA'S turn is done —
 * any delegated work continues in the background (worker research → queued
 * relay), streaming over the session's SSE channel as it lands. Note: the
 * background continuation assumes a long-lived server process (next dev / a
 * node server); a serverless platform that freezes the process right after the
 * response would stall in-flight delegations until the next request.
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
