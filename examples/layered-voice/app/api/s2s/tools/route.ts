// The S2S tool bridge — the browser's `httpToolHost` posts here and the
// worker answers. Two exports and an options bag; the dispatch, the run
// serialization, and the final-message salvage all live in the host.

import { createS2SToolHandler } from "glove-voice-s2s/server";
import { s2sHost } from "@/lib/server/s2s";
import { logMetric } from "@/lib/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const handler = createS2SToolHandler(s2sHost, {
  onCall: ({ name, ms, ok }) => {
    void logMetric({
      ts: new Date().toISOString(),
      sessionId: "s2s",
      source: "server",
      name: "s2s_worker_ms",
      ms,
      data: { tool: name, ok },
    });
  },
});

export const GET = handler;
export const POST = handler;
