/** Throw the session away — closes its worker and drops the tree. */
import { peekDesk } from "@/lib/desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { sessionId } = (await req.json()) as { sessionId?: string };
  const desk = sessionId ? peekDesk(sessionId) : undefined;
  if (desk) {
    ((globalThis as Record<string, unknown>).__deskRegistry as Map<string, unknown>).delete(sessionId!);
    await desk.env.close().catch(() => {});
  }
  return Response.json({ ok: true });
}
