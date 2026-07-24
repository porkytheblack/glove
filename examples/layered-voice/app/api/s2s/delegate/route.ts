import type { IGloveRunnable } from "glove-core";
import { buildWorkerAgent } from "@/lib/server/worker-agent";
import { createAgentStore } from "@/lib/server/stores";
import { logMetric } from "@/lib/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The S2S delegation bridge: the realtime front model calls its
// delegate_to_worker tool → the browser POSTs here → the SAME heavy text
// worker (minimax + the full DB tool surface) researches → findings return
// as the tool result. No mesh needed in this mode: the reply channel is the
// HTTP response, and the worker's final message text IS the deliverable
// (the layered-voice orchestrator already treats it as such via salvage).
const g = globalThis as unknown as { __s2sWorker?: IGloveRunnable; __s2sQueue?: Promise<unknown> };
function worker(): IGloveRunnable {
  if (!g.__s2sWorker) g.__s2sWorker = buildWorkerAgent(createAgentStore("s2s_worker"));
  return g.__s2sWorker;
}

export async function POST(req: Request) {
  let request: string;
  try {
    const body = (await req.json()) as { request?: string };
    request = (body.request ?? "").toString().trim();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!request) return Response.json({ error: "request is required" }, { status: 400 });

  // Serialize runs — the worker agent is single-threaded over its history.
  const run = (g.__s2sQueue ?? Promise.resolve()).then(async () => {
    const t0 = Date.now();
    const w = worker();
    await w.processRequest(
      `[Delegated request from the front desk] ${request}\n\nResearch this with your tools, then state your findings as plain text (no tool calls needed to reply — your final message IS the reply).`,
    );
    const messages = (await w.store.getMessages?.()) ?? [];
    let result = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as { sender?: string; text?: string };
      if (m.sender === "agent" && m.text && m.text.trim().length > 20) {
        result = m.text.trim();
        break;
      }
    }
    void logMetric({
      ts: new Date().toISOString(),
      sessionId: "s2s",
      source: "server",
      name: "s2s_worker_ms",
      ms: Date.now() - t0,
      data: { requestChars: request.length, resultChars: result.length },
    });
    return result;
  });
  g.__s2sQueue = run.catch(() => {});

  try {
    const result = await run;
    if (!result) return Response.json({ result: "The worker produced no findings." });
    return Response.json({ result });
  } catch (err) {
    return Response.json({ error: (err as Error)?.message ?? "worker failed" }, { status: 500 });
  }
}
