/**
 * Run ONE (model × scenario × arm) cell: build a fresh mock org (clean outbox),
 * a fresh model adapter, the requested arm, drive the task to completion (or a
 * timeout), grade it, and return metrics + the full event transcript.
 */
import { createAdapter } from "glove-core";
import type { ArmName, ArmConfig } from "./arms";
import { buildBaselineArm, buildScratchpadArm, buildLispArm, buildBothArm, buildJsArm, buildLispFnArm, baselineToolTotal } from "./arms";
import { buildMockOrg } from "../mcp/index";
import type { Scenario } from "../scenarios";
import type { BenchModel } from "../models";
import { estimateCost } from "../models";
import type { TranscriptEntry } from "./instrument";

export interface RunResult {
  modelKey: string;
  model: string;
  scenario: string;
  arm: ArmName;
  ok: boolean;
  errored: boolean;
  errorMessage?: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  mcpRoundTrips: number;
  servicesTouched: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  peakContextTokens: number;
  compactions: number;
  toolsInContext: number;
  wallMs: number;
  costUsd: number;
  finalText: string;
  /** Which surface the model reached for (calls per tool name). */
  toolMix?: Record<string, number>;
  expected: unknown;
}

function finalText(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const r = res as { messages?: Array<{ text?: string }>; text?: string };
  if (Array.isArray(r.messages)) return r.messages.map((m) => m.text ?? "").join("\n").trim();
  if (typeof r.text === "string") return r.text.trim();
  return "";
}

export interface RunOptions extends ArmConfig {
  maxTokens: number;
  timeoutMs: number;
  scale?: number;
  seed?: number;
  /** Distractor MCP servers to mount alongside the core ten (production noise). */
  distractors?: number;
}

export async function runOne(
  bm: BenchModel,
  scenario: Scenario,
  arm: ArmName,
  opts: RunOptions,
): Promise<{ result: RunResult; transcript: TranscriptEntry[] }> {
  const org = await buildMockOrg({ seed: opts.seed ?? 1337, scale: opts.scale, distractors: opts.distractors });
  const model = createAdapter({
    provider: "openrouter",
    model: bm.model,
    maxTokens: opts.maxTokens,
    stream: false,
  });

  const built =
    arm === "baseline"
      ? await buildBaselineArm(model, org, opts)
      : arm === "lisp"
        ? await buildLispArm(model, org, opts)
        : arm === "both"
          ? await buildBothArm(model, org, opts)
          : arm === "jsrepl"
            ? await buildJsArm(model, org, opts)
            : arm === "lispfns"
              ? await buildLispFnArm(model, org, opts)
              : await buildScratchpadArm(model, org, opts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const t0 = Date.now();
  let errored = false;
  let errorMessage: string | undefined;
  let text = "";
  try {
    const res = await built.runnable.processRequest(scenario.prompt, controller.signal);
    text = finalText(res);
  } catch (err) {
    errored = true;
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  const wallMs = Date.now() - t0;

  let ok = false;
  let expected: unknown = null;
  if (!errored) {
    try {
      const v = scenario.verify(text, org.world);
      ok = v.pass;
      expected = v.expected;
    } catch (e) {
      expected = `verify-error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const m = built.sub.metrics;
  const mcpRoundTrips = [...org.meter.values()].reduce((a, b) => a + b, 0);
  const result: RunResult = {
    modelKey: bm.key,
    model: bm.model,
    scenario: scenario.id,
    arm,
    ok,
    errored,
    errorMessage,
    turns: m.turns,
    toolCalls: m.toolCalls,
    toolErrors: m.toolErrors,
    mcpRoundTrips,
    servicesTouched: org.meter.size,
    tokensIn: m.tokensIn,
    tokensOut: m.tokensOut,
    cacheRead: m.cacheRead,
    peakContextTokens: m.peakContextTokens,
    compactions: m.compactions,
    toolsInContext: arm === "baseline" ? baselineToolTotal(org) : built.toolsInContext,
    wallMs,
    costUsd: estimateCost(bm, m.tokensIn, m.tokensOut),
    finalText: text,
    toolMix: built.sub.metrics.toolCallsByName,
    expected,
  };

  await org.close();
  return { result, transcript: built.sub.transcript };
}
