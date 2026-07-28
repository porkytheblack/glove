/**
 * run_script orchestration: execute, serialize, truncate-with-spillover,
 * and append to /.env/history.jsonl.
 */
import type { EnvLimits, RunResult } from "../types";
import type { EnvCore } from "../core/env";
import type { RunLog } from "../history/runlog";
import type { ScriptExecutor } from "../executor/executor";
import { serializeResult, withSpillover } from "./format";
import { normalizePath } from "../paths";

export interface RunDeps {
  core: EnvCore;
  runlog: RunLog;
  limits: EnvLimits;
}

export interface RunOutcome {
  run: RunResult;
  /** Formatted, truncation-applied response body. */
  text: string;
  /** First line of the error, for the tool result message. */
  shortError?: string;
  spill: string | null;
}

const PREVIEW_CHARS = 200;
const ARGS_CHARS = 500;

/**
 * History lines are ring-buffered by COUNT, so an unbounded per-line payload
 * makes the file unbounded. Keep args renderable but capped.
 */
function boundArgs(args: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(args) ?? "undefined";
  } catch {
    return "[unserializable args]";
  }
  if (json.length <= ARGS_CHARS) return args;
  return `${json.slice(0, ARGS_CHARS)}… [${json.length} chars total]`;
}

export async function executeRun(
  deps: RunDeps & { executor?: ScriptExecutor },
  pathRaw: string,
  args: unknown,
  opts?: { spill?: boolean },
): Promise<RunOutcome> {
  const { core, runlog, limits } = deps;
  const path = normalizePath(pathRaw);
  const executor = deps.executor ?? core.executorRef();
  const runId = runlog.nextRunId();

  const run = await executor.run(path, args);
  const resultText = run.ok ? serializeResult(run.result) : "";
  const spillWanted = opts?.spill !== false;

  const sections: string[] = [];
  let spill: string | null = null;

  if (run.ok) {
    sections.push(`ok (${run.durationMs}ms)`);
    const body = spillWanted
      ? await withSpillover(core, resultText, `/tmp/run-${runId}.out`, limits, 0.7)
      : { text: resultText, spilled: null };
    spill = body.spilled;
    sections.push(`result:\n${body.text}`);
  } else {
    sections.push(`error (${run.durationMs}ms)`);
    const errText = run.error ?? "unknown error";
    const body = spillWanted
      ? await withSpillover(core, errText, `/tmp/run-${runId}.err`, limits, 0.7)
      : { text: errText, spilled: null };
    spill = body.spilled;
    sections.push(body.text);
  }

  if (run.stdout) {
    const body = spillWanted
      ? await withSpillover(core, run.stdout, `/tmp/run-${runId}.log`, limits, 0.3)
      : { text: run.stdout, spilled: null };
    spill = spill ?? body.spilled;
    sections.push(`stdout:\n${body.text}`);
  }
  if (run.stderr) {
    const body = spillWanted
      ? await withSpillover(core, run.stderr, `/tmp/run-${runId}.err`, limits, 0.3)
      : { text: run.stderr, spilled: null };
    spill = spill ?? body.spilled;
    sections.push(`stderr:\n${body.text}`);
  }

  await runlog.append({
    id: runId,
    ts: new Date().toISOString(),
    script: path,
    args: boundArgs(args),
    ok: run.ok,
    durationMs: run.durationMs,
    resultPreview: run.ok ? resultText.slice(0, PREVIEW_CHARS) : null,
    spill,
    ...(run.ok ? {} : { error: (run.error ?? "").slice(0, PREVIEW_CHARS) }),
  });

  return {
    run,
    text: sections.join("\n"),
    shortError: run.ok ? undefined : (run.error ?? "script failed").split("\n")[0].slice(0, 400),
    spill,
  };
}
