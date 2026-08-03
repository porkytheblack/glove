/**
 * `/.env/orientation.md` — "where am I and what has happened here?" in one read.
 *
 * An agent resuming from a snapshot (a new session, a scheduled follow-up, a
 * handoff) starts blind and reconstructs context with `ls /scripts`,
 * `ls /inbox`, `ls /out` and `history`: four calls and four partial pictures,
 * repeated at the start of every session. The environment already knows all
 * of it.
 *
 * Built on read, never cached. A file maintained on every mutation is a file
 * that goes stale on the mutation someone forgot to hook — deletes, moves,
 * a script rewritten through undo — and a stale orientation file is worse
 * than none, because it is believed. Regenerating costs a tree walk on the
 * one read that asks for it.
 *
 * Bounded like any tool response: this is read into context, so every section
 * caps and names the verb that shows the rest.
 */
import type { EnvCore } from "../core/env";
import type { RunLog } from "../history/runlog";
import { fmtBytes } from "./format";

/** Only `tail` is needed; structural so a test can pass a stub. */
type RunLogLike = Pick<RunLog, "tail">;

export const ORIENTATION_PATH = "/.env/orientation.md";

const ZONES = [
  ["/inbox", "inputs mounted by the host"],
  ["/scripts", "your persistent script library"],
  ["/out", "deliverables — this is what the host exports"],
  ["/tmp", "intermediates and spilled run output"],
] as const;

const MAX_SCRIPTS = 15;
const MAX_OUT = 15;
const MAX_RUNS = 8;

export async function buildOrientation(core: EnvCore, runlog: RunLogLike | null): Promise<string> {
  const lines: string[] = [
    "# Orientation",
    "",
    "Regenerated every time this file is read. If it disagrees with `ls`, trust `ls`.",
    "",
    "## Tree",
    "",
  ];

  for (const [zone, blurb] of ZONES) {
    const files = (await core.glob(`${zone}/**`)).filter((p) => !p.endsWith(".d.ts"));
    let bytes = 0;
    for (const f of files) bytes += (await core.stat(f))?.size ?? 0;
    lines.push(files.length === 0 ? `- \`${zone}\` — empty (${blurb})` : `- \`${zone}\` — ${files.length} file(s), ${fmtBytes(bytes)} (${blurb})`);
  }

  // --- the script catalogue -----------------------------------------------
  const scripts = (await core.glob("/scripts/**/*.js")).sort();
  lines.push("", "## Scripts you can run", "");
  if (scripts.length === 0) {
    lines.push("None yet. `write_file` a script under `/scripts` that `export default async function (args)`, then `run_script` it.");
  } else {
    for (const path of scripts.slice(0, MAX_SCRIPTS)) {
      const desc = await core.describeScript(path).catch(() => null);
      lines.push(`- \`${path}\`${desc ? ` — ${desc}` : ""}`);
    }
    if (scripts.length > MAX_SCRIPTS) {
      lines.push(`- … ${scripts.length - MAX_SCRIPTS} more — \`ls /scripts\` for the full catalogue`);
    }
  }

  // --- modules, with real usage counts -------------------------------------
  const usage = await core.moduleUsage();
  lines.push("", "## Modules scripts can import", "");
  for (const [name, description] of core.moduleDescriptions) {
    const n = usage.get(name)?.length ?? 0;
    const used = n === 0 ? "" : ` — used by ${n} script(s)`;
    lines.push(`- \`env:${name}\` — ${description}${used}`);
  }
  lines.push("", "Signatures live in `/std/<name>/index.d.ts`. Read them before calling in.");

  // --- deliverables ---------------------------------------------------------
  const out = (await core.glob("/out/**")).sort();
  lines.push("", "## Currently in /out", "");
  if (out.length === 0) {
    lines.push("Nothing yet.");
  } else {
    for (const p of out.slice(0, MAX_OUT)) lines.push(`- \`${p}\` (${fmtBytes((await core.stat(p))?.size ?? 0)})`);
    if (out.length > MAX_OUT) lines.push(`- … ${out.length - MAX_OUT} more — \`ls /out\``);
  }

  // --- what has run ---------------------------------------------------------
  lines.push("", "## Recent runs", "");
  const runs = runlog ? await runlog.tail(MAX_RUNS) : [];
  if (runs.length === 0) {
    lines.push("No scripts have been run yet.");
  } else {
    for (const r of runs) {
      const status = r.ok ? "ok" : "FAIL";
      const extra = r.ok ? (r.resultPreview ?? "") : (r.error ?? "");
      lines.push(`- ${status} \`${r.script}\` ${JSON.stringify(r.args ?? {})} (${r.durationMs}ms)${extra ? ` — ${extra.split("\n")[0].slice(0, 120)}` : ""}`);
    }
    lines.push("", "Full history: `history`, or grep `/.env/history.jsonl`.");
  }

  lines.push("");
  return lines.join("\n");
}
