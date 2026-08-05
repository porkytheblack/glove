import { logMetric, metricsFilePath } from "@/lib/server/metrics";
import type { MetricRecord } from "@/lib/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ingest client-measured metrics (STT latency, time-to-first-audio, barge-ins,
 * TTS timings) and append them to the same local JSONL file the server writes.
 * Body: a single MetricRecord or `{ records: MetricRecord[] }`.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { records?: unknown }).records;
  const records = (Array.isArray(raw) ? raw : [body]) as MetricRecord[];

  for (const r of records) {
    if (!r || typeof r.name !== "string") continue;
    await logMetric({
      ts: r.ts ?? new Date().toISOString(),
      sessionId: r.sessionId ?? "unknown",
      source: "client",
      name: r.name,
      ...(typeof r.ms === "number" ? { ms: Math.round(r.ms) } : {}),
      ...(r.utteranceId ? { utteranceId: r.utteranceId } : {}),
      ...(r.data ? { data: r.data } : {}),
    });
  }

  return Response.json({ ok: true, file: metricsFilePath() });
}
