import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report a client-side audio-channel event so it gets logged into the front
 * agent's history as a tagged notice (<user-interruption> / <speech-failure>).
 * Body: { type: "user-interruption", heard?: string }
 *     | { type: "speech-failure", detail?: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  let body: { type?: string; heard?: string; detail?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  switch (body.type) {
    case "user-interruption":
      session.noteInterruption((body.heard ?? "").toString());
      break;
    case "speech-failure":
      session.noteSpeechFailure(body.detail ? body.detail.toString() : undefined);
      break;
    default:
      return Response.json({ error: `unknown event type "${body.type}"` }, { status: 400 });
  }

  return Response.json({ ok: true });
}
