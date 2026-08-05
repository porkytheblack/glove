// Local metrics sink. Every voice/latency measurement — server-measured and
// client-measured — is appended as one JSON line to a file on disk so it can be
// loaded later for analysis (e.g. `cat voice-metrics.jsonl | jq`).

import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { MetricRecord } from "../shared/types";

export function metricsFilePath(): string {
  const file = process.env.VOICE_METRICS_FILE || "voice-metrics.jsonl";
  return path.isAbsolute(file) ? file : path.join(process.cwd(), file);
}

/** Append one metric record as a JSON line. Never throws into the caller. */
export async function logMetric(rec: MetricRecord): Promise<void> {
  try {
    await appendFile(metricsFilePath(), JSON.stringify(rec) + "\n", "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[metrics] failed to append:", (err as Error)?.message ?? err);
  }
}
