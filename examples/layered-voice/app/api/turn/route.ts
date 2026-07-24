import { getEouScorer } from "@/lib/server/eou";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The end-of-utterance scorer runs SERVER-SIDE (the LiveKit deployment
// shape): livekit/turn-detector weights via transformers.js, ~20-30ms per
// score on CPU after warmup. Session creation warms the singleton so the
// first spoken turn doesn't pay the model-load cost.
const scorer = getEouScorer;

/**
 * POST { transcript, context? } → { probability, ms }. Consumed by
 * RemoteTurnDetector. `context` is the recent conversation (oldest first) —
 * it sharpens the model a lot: "My engine." is complete on its own but
 * clearly unfinished right after the agent asked "what do you need?".
 */
export async function POST(req: Request) {
  let transcript: string;
  let context: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const body = (await req.json()) as {
      transcript?: string;
      context?: Array<{ role?: string; content?: string }>;
    };
    transcript = (body.transcript ?? "").toString();
    context = (body.context ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-6)
      .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!transcript.trim()) return Response.json({ probability: 0, ms: 0 });

  try {
    const t0 = Date.now();
    const probability = await scorer().probability([
      ...context,
      { role: "user", content: transcript },
    ]);
    return Response.json({ probability, ms: Date.now() - t0 });
  } catch (err) {
    return Response.json(
      { error: (err as Error)?.message ?? "scoring failed" },
      { status: 500 },
    );
  }
}
