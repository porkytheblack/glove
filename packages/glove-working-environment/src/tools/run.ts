/**
 * run_script orchestration: execute, serialize, truncate-with-spillover,
 * and append to /.env/history.jsonl.
 */
import type { EnvLimits, RunResult } from "../types";
import type { EnvCore } from "../core/env";
import type { RunLog } from "../history/runlog";
import type { WorkerPool } from "../executor/pool";
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

/**
 * Say why a path is not runnable, before the module loader gets a chance to
 * say it badly.
 *
 * Agent evaluation (benches/working-environment-bench) showed this is the
 * single biggest source of wasted turns. Running a script that does not exist
 * yet reported "no such module: /scripts/x.js" — the *import resolver's*
 * error, surfacing on a verb the model called with a path, so it reads as a
 * dependency problem rather than "you have not written this". And running
 * anything under /std tried to parse a `.d.ts` as a module, producing
 * "could not parse export statement" from a file the model had just been
 * told to read for documentation.
 */
async function explainUnrunnable(core: EnvCore, path: string): Promise<string | null> {
  if (path === "/std" || path.startsWith("/std/")) {
    // Imperative first. The earlier wording opened with the path and buried
    // the action three clauses in; one model read it and recovered, another
    // repeated the same call three times. Leading with the fix costs nothing
    // and is the only part worth reading twice.
    const mod = path.split("/")[2] ?? "<name>";
    return (
      `Write a script under /scripts that imports it, and run that instead: ` +
      `import { … } from 'env:${mod}'. ` +
      `(${path} is a type declaration — /std is documentation, not runnable code.)`
    );
  }

  const stat = await core.stat(path);
  if (stat === null) {
    const siblings = (await core.list("/scripts").catch(() => []))
      .filter((e) => e.kind === "file" && e.name.endsWith(".js"))
      .map((e) => `/scripts/${e.name}`);
    const hint = siblings.length
      ? ` Existing scripts: ${siblings.slice(0, 8).join(", ")}${siblings.length > 8 ? `, +${siblings.length - 8} more` : ""}.`
      : ` /scripts is empty — write_file the script first.`;
    return `no such script: ${path}.${hint}`;
  }
  if (stat.kind === "dir") {
    return `${path} is a directory, not a script. Name the .js file to run.`;
  }
  if (!path.endsWith(".js")) {
    return `${path} is not a .js file. run_script executes JavaScript modules under /scripts.`;
  }
  return null;
}

export async function executeRun(
  deps: RunDeps & { executor?: WorkerPool },
  pathRaw: string,
  args: unknown,
  opts?: { spill?: boolean; kind?: "test" },
): Promise<RunOutcome> {
  const { core, runlog, limits } = deps;
  const path = normalizePath(pathRaw);
  const executor = deps.executor ?? core.executorRef();
  const runId = runlog.nextRunId();

  const unrunnable = await explainUnrunnable(core, path);
  const startedAt = Date.now();
  const run = unrunnable
    ? { ok: false, result: undefined, stdout: "", stderr: "", durationMs: 0, error: unrunnable }
    : await executor
        .execute({ mode: "run", path, args, readOnly: false })
        .then((r) => ({
          ok: r.ok,
          result: r.result,
          stdout: r.stdout,
          stderr: r.stderr,
          durationMs: Date.now() - startedAt,
          error: r.error,
        }));
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
    ...(opts?.kind ? { kind: opts.kind } : {}),
    ...(run.ok ? {} : { error: (run.error ?? "").slice(0, PREVIEW_CHARS) }),
  });

  return {
    run,
    text: sections.join("\n"),
    shortError: run.ok ? undefined : (run.error ?? "script failed").split("\n")[0].slice(0, 400),
    spill,
  };
}
