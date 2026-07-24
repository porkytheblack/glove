import * as transformers from "@huggingface/transformers";
import { LiveKitEouScorer } from "glove-voice/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The end-of-utterance scorer runs SERVER-SIDE (the LiveKit deployment
// shape): livekit/turn-detector weights via transformers.js, ~20-30ms per
// score on CPU after warmup. Singleton survives Next.js HMR; the first
// request downloads the quantized weights into the HF cache (~150MB,
// one-time) — hit this route once after boot to warm it.
const g = globalThis as unknown as { __eouScorer?: LiveKitEouScorer };
function scorer(): LiveKitEouScorer {
  if (!g.__eouScorer) g.__eouScorer = new LiveKitEouScorer({ transformers });
  return g.__eouScorer;
}

/** POST { transcript } → { probability, ms }. Consumed by RemoteTurnDetector. */
export async function POST(req: Request) {
  let transcript: string;
  try {
    const body = (await req.json()) as { transcript?: string };
    transcript = (body.transcript ?? "").toString();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!transcript.trim()) return Response.json({ probability: 0, ms: 0 });

  try {
    const t0 = Date.now();
    const probability = await scorer().probability([{ role: "user", content: transcript }]);
    return Response.json({ probability, ms: Date.now() - t0 });
  } catch (err) {
    return Response.json(
      { error: (err as Error)?.message ?? "scoring failed" },
      { status: 500 },
    );
  }
}
