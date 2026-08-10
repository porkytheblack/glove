/**
 * The other half of `ask_user`.
 *
 * The verb's promise is still pending on the server while the browser shows
 * the question, so the agent's turn is genuinely blocked on a human being.
 * This resolves it, and the turn continues on the same SSE stream that asked.
 */
import { peekDesk } from "@/lib/desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { sessionId, id, answer } = (await req.json()) as {
    sessionId?: string;
    id?: string;
    answer?: string;
  };
  if (!sessionId || !id || typeof answer !== "string") {
    return Response.json({ error: "sessionId, id and answer are required" }, { status: 400 });
  }

  // `peekDesk`, not `getDesk`: an answer to a question asked by a session that
  // no longer exists should say so, not quietly build a new environment for
  // the answer to land in.
  const desk = peekDesk(sessionId);
  const pending = desk?.questions.get(id);
  if (!pending) {
    return Response.json({ error: "that question is no longer waiting for an answer" }, { status: 404 });
  }

  pending.resolve(answer);
  return Response.json({ ok: true });
}
