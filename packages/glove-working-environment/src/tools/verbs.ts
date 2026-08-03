/**
 * The complete, closed model-facing verb set (§5 of the design):
 * write_file, edit_file, rm, mv, cp · read_file, ls, grep, describe ·
 * run_script · undo, redo, history. All paths are VFS paths. Doors,
 * snapshots, and adapter registration are host-side and invisible from here.
 *
 * `describe` is the one addition to the spec's closed twelve, and it earns
 * the exception: every format adapter already exposes `describe(path)` by
 * convention, but reaching it meant writing a script, running it, and reading
 * the result — three calls and a context round-trip for pure orientation,
 * which agent evaluation shows is the first thing a model does with an
 * unfamiliar inbox.
 */
import type { EnvLimits, EnvTool, EnvToolResult } from "../types";
import type { EnvCore } from "../core/env";
import type { RunLog } from "../history/runlog";
import { executeRun } from "./run";
import { capResponse, fmtBytes, fmtCount, numberLines, truncateText } from "./format";
import { RepeatTracker, escalate } from "./repeat";

interface ToolDeps {
  core: EnvCore;
  runlog: RunLog;
  limits: EnvLimits;
  prefix: string;
}

/**
 * The `env:*` modules a script may import, rendered for the run_script tool
 * description. Bounded: a host registering a dozen adapters should not push
 * the rest of the description out of the model's attention.
 */
function moduleCatalogue(descriptions: ReadonlyMap<string, string>): string {
  const entries = [...descriptions.entries()];
  if (entries.length === 0) return "";
  const parts: string[] = [];
  let budget = 600;
  let dropped = 0;
  for (const [mod, description] of entries) {
    const line = `env:${mod} — ${description}`;
    if (line.length > budget) {
      dropped += 1;
      continue;
    }
    budget -= line.length;
    parts.push(line);
  }
  const tail = dropped > 0 ? ` (+${dropped} more; see /std/README.md)` : "";
  return `Scripts may import: ${parts.join("; ")}${tail}. Full types live in /std/<name>/index.d.ts.`;
}

const ok = (data: unknown): EnvToolResult => ({ status: "success", data });
const err = (message: string, data?: unknown): EnvToolResult => ({ status: "error", message, data: data ?? null });

/**
 * Backstop applied to EVERY verb result. Individual verbs shape their own
 * output (with spillover where the full text is worth keeping), but nothing
 * may hand the model an unbounded string — including error paths, which are
 * the easiest to forget.
 */
function bounded(result: EnvToolResult, limits: EnvLimits): EnvToolResult {
  const out: EnvToolResult = { ...result };
  if (typeof out.data === "string") out.data = capResponse(out.data, limits, 1.5);
  if (typeof out.message === "string") out.message = capResponse(out.message, limits, 0.5);
  return out;
}

/**
 * Wrap a verb body: normalize a missing input to `{}`, turn a thrown error
 * into an error result, escalate a repeated identical failure, and cap the
 * response. Thrown and returned failures are treated the same — a model
 * cannot tell them apart and neither should the retry counter.
 */
function guarded(
  verb: string,
  limits: EnvLimits,
  repeats: RepeatTracker,
  fn: (input: any) => Promise<EnvToolResult>,
): (input: any) => Promise<EnvToolResult> {
  return async (input) => {
    let result: EnvToolResult;
    try {
      result = await fn(input ?? {});
    } catch (e) {
      result = err(e instanceof Error ? e.message : String(e));
    }
    if (result.status === "error" && typeof result.message === "string") {
      const n = repeats.note(verb, input ?? {}, result.message);
      result = { ...result, message: escalate(result.message, n) };
    }
    return bounded(result, limits);
  };
}

const str = (desc: string): Record<string, unknown> => ({ type: "string", description: desc });
const int = (desc: string): Record<string, unknown> => ({ type: "integer", description: desc });

function schema(props: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties: props, required, additionalProperties: false };
}

export function buildTools(deps: ToolDeps): EnvTool[] {
  const { core, limits, prefix } = deps;
  const name = (n: string) => `${prefix}${n}`;
  // One tracker per environment: the loop being detected is a model repeating
  // itself within a session, so the counts must outlive individual calls and
  // must not be shared between environments.
  const repeats = new RepeatTracker();
  const guard = (verb: string, fn: (input: any) => Promise<EnvToolResult>) => guarded(verb, limits, repeats, fn);

  const writeFile: EnvTool = {
    name: name("write_file"),
    description:
      "Write a file in the working environment (parent directories are auto-created). " +
      "Scripts (.js under /scripts) are validated on write: they must `export default async function (args) { ... }`, and a sibling .d.ts is generated from the signature + JSDoc. " +
      "Use append:true to add to an existing file.",
    jsonSchema: schema(
      {
        path: str("Absolute VFS path, e.g. /scripts/parse_invoice.js or /tmp/notes.md"),
        content: str("Full file content (or the chunk to append)"),
        append: { type: "boolean", description: "Append instead of overwrite. Default false." },
      },
      ["path", "content"],
    ),
    do: guard("write_file", async (input: { path: string; content: string; append?: boolean }) => {
      if (typeof input.path !== "string" || typeof input.content !== "string") {
        return err("write_file needs { path, content } as strings");
      }
      const r = await core.write(input.path, input.content, { append: input.append });
      const verb = input.append ? "appended to" : r.created ? "created" : "wrote";
      let msg = `${verb} ${input.path} (${fmtBytes(r.bytes)})`;
      if (core.isEnforcedScript(input.path)) msg += ` — .d.ts regenerated`;
      if (r.nudge) msg += `\n${r.nudge}`;
      return ok(msg);
    }),
  };

  const editFile: EnvTool = {
    name: name("edit_file"),
    description:
      "Replace text in a file: old_str must match the current content exactly once (fails on zero or multiple matches, reporting the count). " +
      "Much cheaper than resending a whole file to change one line. Script edits re-run validation and regenerate the sibling .d.ts.",
    jsonSchema: schema(
      {
        path: str("Absolute VFS path of the file to edit"),
        old_str: str("Exact text to replace — must occur exactly once"),
        new_str: str("Replacement text"),
      },
      ["path", "old_str", "new_str"],
    ),
    do: guard("edit_file", async (input: { path: string; old_str: string; new_str: string }) => {
      if (typeof input.path !== "string" || typeof input.old_str !== "string" || typeof input.new_str !== "string") {
        return err("edit_file needs { path, old_str, new_str } as strings");
      }
      const r = await core.edit(input.path, input.old_str, input.new_str);
      let msg = `edited ${input.path} (1 replacement, now ${fmtBytes(r.bytes)})`;
      if (r.nudge) msg += `\n${r.nudge}`;
      return ok(msg);
    }),
  };

  const rm: EnvTool = {
    name: name("rm"),
    description: "Remove a file (or a directory recursively). Removes a script's sibling .d.ts with it. Undoable per file via undo.",
    jsonSchema: schema({ path: str("Absolute VFS path to remove") }, ["path"]),
    do: guard("rm", async (input: { path: string }) => {
      const r = await core.rm(input.path);
      return ok(r.removed.length === 1 ? `removed ${r.removed[0]}` : `removed ${r.removed.length} files under ${input.path}`);
    }),
  };

  const mv: EnvTool = {
    name: name("mv"),
    description:
      "Move/rename a file or directory. Moves a script's sibling .d.ts along with it; scripts arriving under /scripts are validated at the destination (relative imports must still resolve).",
    jsonSchema: schema({ from: str("Source VFS path"), to: str("Destination VFS path") }, ["from", "to"]),
    do: guard("mv", async (input: { from: string; to: string }) => {
      const r = await core.mv(input.from, input.to);
      let msg =
        r.moved.length === 1
          ? `moved ${r.moved[0][0]} -> ${r.moved[0][1]}`
          : `moved ${r.moved.length} files from ${input.from} to ${input.to}`;
      if (r.nudge) msg += `\n${r.nudge}`;
      return ok(msg);
    }),
  };

  const cp: EnvTool = {
    name: name("cp"),
    description: "Copy a file or directory. Copied scripts are re-validated at the destination and get a freshly generated .d.ts.",
    jsonSchema: schema({ from: str("Source VFS path"), to: str("Destination VFS path") }, ["from", "to"]),
    do: guard("cp", async (input: { from: string; to: string }) => {
      const r = await core.cp(input.from, input.to);
      let msg =
        r.moved.length === 1
          ? `copied ${r.moved[0][0]} -> ${r.moved[0][1]}`
          : `copied ${r.moved.length} files from ${input.from} to ${input.to}`;
      if (r.nudge) msg += `\n${r.nudge}`;
      return ok(msg);
    }),
  };

  const readFile: EnvTool = {
    name: name("read_file"),
    description:
      `Read a text file with line numbers. Shows at most ${limits.maxToolResponseLines} lines per call — use start_line/end_line to slice large files instead of paging blindly. Binary files are refused (inspect those from a script via an adapter's describe()).`,
    jsonSchema: schema(
      {
        path: str("Absolute VFS path to read"),
        start_line: int("1-indexed first line to show (default 1)"),
        end_line: int("1-indexed last line to show (inclusive)"),
      },
      ["path"],
    ),
    do: guard("read_file", async (input: { path: string; start_line?: number; end_line?: number }) => {
      const text = await core.readText(input.path);
      const lines = text.split("\n");
      const total = lines.length;
      const start = Math.max(1, Math.floor(input.start_line ?? 1));
      const requestedEnd = input.end_line === undefined ? total : Math.floor(input.end_line);
      const cappedEnd = Math.min(requestedEnd, total, start + limits.maxToolResponseLines - 1);
      if (start > total) return err(`start_line ${start} is past the end of ${input.path} (${fmtCount(total)} lines)`);
      const slice = lines.slice(start - 1, cappedEnd);
      const body = capResponse(numberLines(slice, start), limits);
      const header =
        cappedEnd < total || start > 1
          ? `showing lines ${fmtCount(start)}–${fmtCount(cappedEnd)} of ${fmtCount(total)} (${input.path})\n`
          : "";
      const tail = cappedEnd < requestedEnd && cappedEnd < total ? `\n… [${fmtCount(total - cappedEnd)} more lines — slice with start_line=${cappedEnd + 1}]` : "";
      return ok(`${header}${body}${tail}`);
    }),
  };

  const ls: EnvTool = {
    name: name("ls"),
    description:
      "List a directory. For /scripts each script shows its one-line JSDoc description — the listing is your capability catalog. For /std it shows each stdlib module's description. depth > 1 recurses.",
    jsonSchema: schema(
      {
        path: str("Directory to list (default /)"),
        depth: int("Recursion depth (default 1, max 10)"),
      },
      [],
    ),
    do: guard("ls", async (input: { path?: string; depth?: number }) => {
      const root = input.path ?? "/";
      const depth = Math.min(Math.max(Math.floor(input.depth ?? 1), 1), 10);
      const entries = await core.lsTree(root, depth);
      if (entries.length === 0) return ok(`${root} is empty`);
      const lines = entries.map((e) => {
        const indent = "  ".repeat(e.depth);
        const label = e.kind === "dir" ? `${e.name}/` : `${e.name} (${fmtBytes(e.size)})`;
        return `${indent}${label}${e.description ? ` — ${e.description}` : ""}`;
      });
      const t = truncateText(lines.join("\n"), limits);
      const tail = t.truncated ? `\n… [${fmtCount(t.totalLines - t.shownLines)} more entries — list a subdirectory or lower depth]` : "";
      return ok(`${root}\n${t.text}${tail}`);
    }),
  };

  const grep: EnvTool = {
    name: name("grep"),
    description:
      "Search file contents with a JS regular expression. Scope with path (file or directory) and glob (e.g. **/*.js). Returns path:line: matches, capped by max_matches. Also works on /.env/history.jsonl for past runs.",
    jsonSchema: schema(
      {
        pattern: str("JS regex source, e.g. invoice|receipt"),
        path: str("File or directory to search (default /)"),
        glob: str("Only search files matching this glob, e.g. /scripts/**/*.js"),
        context: int("Context lines around each match (default 0, max 10)"),
        max_matches: int("Stop after this many matches (default 20, max 200)"),
      },
      ["pattern"],
    ),
    do: guard("grep", async (input: { pattern: string; path?: string; glob?: string; context?: number; max_matches?: number }) => {
      if (typeof input.pattern !== "string") return err("grep needs { pattern }");
      const r = await core.grep(input.pattern, input.path ?? "/", {
        glob: input.glob,
        context: input.context,
        maxMatches: input.max_matches,
      });
      if (r.matches.length === 0) return ok(`no matches for /${input.pattern}/ (${r.filesScanned} files scanned)`);
      const chunks: string[] = [];
      for (const m of r.matches) {
        const before = m.before.map((l, i) => `${m.path}:${m.line - m.before.length + i}- ${l}`);
        const after = m.after.map((l, i) => `${m.path}:${m.line + 1 + i}- ${l}`);
        chunks.push([...before, `${m.path}:${m.line}: ${m.text}`, ...after].join("\n"));
      }
      const sep = (input.context ?? 0) > 0 ? "\n--\n" : "\n";
      let out = chunks.join(sep);
      const t = truncateText(out, limits);
      out = t.truncated ? `${t.text}\n… [more matches truncated]` : t.text;
      if (r.truncated) out += `\n${r.matches.length} matches shown (capped at max_matches=${input.max_matches ?? 20} — narrow the pattern or raise the cap)`;
      return ok(out);
    }),
  };

  const runScript: EnvTool = {
    name: name("run_script"),
    description:
      "Run a script's default export with JSON args: `await defaultExport(args)`. Returns the result plus captured stdout/stderr and duration. " +
      "Oversized output is truncated here and written in full to a /tmp/run-<id>.* file — read slices of that file instead of re-running. Every run is appended to /.env/history.jsonl. " +
      // The importable modules belong here, not only in the system prompt: a
      // host that folds the verbs directly (rather than via
      // mountWorkingEnvironment) would otherwise leave the model to discover
      // its own capabilities by guesswork.
      moduleCatalogue(core.moduleDescriptions),
    jsonSchema: schema(
      {
        path: str("Script path, e.g. /scripts/csv_to_report.js"),
        args: { type: "object", description: "Plain-JSON arguments object passed to the default export. Default {}.", additionalProperties: true },
      },
      ["path"],
    ),
    do: guard("run_script", async (input: { path: string; args?: unknown }) => {
      if (typeof input.path !== "string") return err("run_script needs { path }");
      const outcome = await executeRun(deps, input.path, input.args ?? {});
      return outcome.run.ok ? ok(outcome.text) : err(outcome.shortError ?? "script failed", outcome.text);
    }),
  };

  const describe: EnvTool = {
    name: name("describe"),
    description:
      "Summarise any file without reading it: dispatches to whichever stdlib module understands the format (by magic bytes, not extension) " +
      "and falls back to a generic summary — size, text-or-binary, line count, first lines. " +
      "This is the orientation verb: use it on an unfamiliar input before writing a script against it. Directories report their contents.",
    jsonSchema: schema({ path: str("Absolute VFS path of the file or directory to summarise") }, ["path"]),
    do: guard("describe", async (input: { path: string }) => {
      if (typeof input.path !== "string") return err("describe needs { path }");
      const summary = await core.describeFile(input.path);
      return ok(JSON.stringify(summary, null, 2));
    }),
  };

  const undo: EnvTool = {
    name: name("undo"),
    description: "Revert a file to its previous version (per-file linear undo; rm and overwrites are both undoable). Scripts re-run the pipeline so the .d.ts stays in sync.",
    jsonSchema: schema({ path: str("File whose last mutation should be reverted") }, ["path"]),
    do: guard("undo", async (input: { path: string }) => {
      const r = await core.undo(input.path);
      const h = await core.historyFor(input.path);
      const state = r.present ? "file restored" : "file removed (this undid its creation)";
      return ok(
        `reverted ${input.path} to the version saved before "${r.restoredOp}" (${new Date(r.ts).toISOString()}); ${state}. ` +
          `${h.undo.length} more undo step(s), ${h.redo.length} redo step(s) available.`,
      );
    }),
  };

  const redo: EnvTool = {
    name: name("redo"),
    description: "Walk forward again after an undo (a fresh mutation clears the redo branch).",
    jsonSchema: schema({ path: str("File to redo") }, ["path"]),
    do: guard("redo", async (input: { path: string }) => {
      const r = await core.redo(input.path);
      const h = await core.historyFor(input.path);
      const state = r.present ? "file restored" : "file removed";
      return ok(
        `redid ${input.path} (${new Date(r.ts).toISOString()}); ${state}. ` +
          `${h.undo.length} undo step(s), ${h.redo.length} more redo step(s) available.`,
      );
    }),
  };

  const history: EnvTool = {
    name: name("history"),
    description:
      "Without a path: recent run_script invocations (from /.env/history.jsonl). With a path: that file's saved versions — what undo/redo would restore.",
    jsonSchema: schema(
      {
        path: str("File to show version history for (omit for run history)"),
        limit: int("Max entries (default 20)"),
      },
      [],
    ),
    do: guard("history", async (input: { path?: string; limit?: number }) => {
      const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);
      if (input.path) {
        const h = await core.historyFor(input.path);
        if (h.undo.length === 0 && h.redo.length === 0) return ok(`no recorded versions for ${input.path}`);
        const fmt = (v: { ts: number; op: string; present: boolean; size: number }) =>
          `${new Date(v.ts).toISOString()}  ${v.op.padEnd(6)}  ${v.present ? fmtBytes(v.size) : "(absent)"}`;
        const lines = [
          `${input.path}: ${h.undo.length} version(s) behind, ${h.redo.length} ahead`,
          ...h.undo.slice(-limit).map((v) => `  undo<- ${fmt(v)}`),
          ...h.redo.slice(-limit).map((v) => `  redo-> ${fmt(v)}`),
        ];
        return ok(lines.join("\n"));
      }
      const runs = await deps.runlog.tail(limit);
      if (runs.length === 0) return ok("no runs recorded yet");
      const lines = runs.map((r) => {
        const status = r.ok ? "ok  " : "FAIL";
        const argsStr = JSON.stringify(r.args ?? {});
        const extra = r.ok ? (r.resultPreview ?? "") : (r.error ?? "");
        const spill = r.spill ? ` spill=${r.spill}` : "";
        return `${r.ts}  ${status} ${r.durationMs}ms  ${r.script} args=${argsStr}${spill}  ${extra}`.trimEnd();
      });
      const t = truncateText(lines.join("\n"), limits);
      return ok(t.truncated ? `${t.text}\n… [older runs truncated — grep /.env/history.jsonl]` : t.text);
    }),
  };

  return [writeFile, editFile, rm, mv, cp, readFile, ls, grep, describe, runScript, undo, redo, history];
}
