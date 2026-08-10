"use client";

/**
 * The verbs, rendered inline in the transcript.
 *
 * One line per call, tinted by what it does to the tree — the point is that
 * you can glance at a turn and see whether the agent was orienting itself,
 * writing, or running something, without reading any of it.
 *
 * Each row opens. The glance view shows one argument, which is the right
 * default and the wrong thing when a call surprises you: `run_script` that
 * failed, a `grep` that found nothing, an `ask_user` you did not expect. The
 * full arguments and the tool's own result were already on the entry and had
 * nowhere to go, so clicking a row now shows them.
 */
import { useState } from "react";
import type { Entry } from "@/lib/useDesk";

type Act = Extract<Entry, { kind: "act" }>;
type Tint = "read" | "write" | "run" | "danger" | "";

const TINT: Record<string, Tint> = {
  read_file: "read",
  ls: "read",
  grep: "read",
  describe: "read",
  history: "read",
  write_file: "write",
  edit_file: "write",
  mv: "write",
  cp: "write",
  checkpoint: "write",
  run_script: "run",
  run_tests: "run",
  rm: "danger",
  undo: "danger",
  redo: "danger",
};

/** The one field of the call worth putting on screen next to the verb name. */
function argument(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "grep":
      return [str("pattern"), str("path")].filter(Boolean).join("  in  ");
    case "mv":
    case "cp":
      return `${str("from")} → ${str("to")}`;
    case "checkpoint":
      return [str("action") || "list", str("name")].filter(Boolean).join(" ");
    case "undo":
    case "redo":
      return str("path");
    case "ask_user":
      return str("question");
    default:
      return str("path");
  }
}

/**
 * Arguments as text, one per line.
 *
 * Not `JSON.stringify(input, null, 2)`: the interesting values here are file
 * contents and script sources, and a JSON blob escapes every newline in them
 * into `\n`, which is exactly the thing you opened the row to read. Strings
 * are printed raw and everything else falls back to JSON.
 */
function formatArgs(input: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(input).map(([key, raw]) => ({
    key,
    value: typeof raw === "string" ? raw : JSON.stringify(raw, null, 2),
  }));
}

function Row({ act }: { act: Act }) {
  // Failures open by default. A red line you have to click to understand is a
  // worse version of the same problem the expansion exists to solve.
  const [open, setOpen] = useState(act.status === "error");
  const tint = TINT[act.name] ?? "";
  const failed = act.status === "error";
  const args = formatArgs(act.input);
  const hasDetail = args.length > 0 || Boolean(act.output);

  return (
    <div className={`act-row${open ? " open" : ""}`}>
      <button
        type="button"
        className={`act ${failed ? "danger failed" : tint} ${act.status === "running" ? "running" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Nothing to open on a call with no arguments and no result yet —
        // pressing it would toggle an empty panel.
        disabled={!hasDetail}
      >
        <span className="act-dot" />
        <span className="act-name">{act.name}</span>
        {/* While a script is running, what it last printed beats the
            argument it was called with: "frame 900/1800" is the thing
            worth showing, and the argument has not changed since the row
            appeared. */}
        <span className="act-arg">
          {failed
            ? (act.output ?? "").split("\n")[0]
            : (act.status === "running" && act.progress) || argument(act.name, act.input)}
        </span>
        {hasDetail && <span className="act-chevron" aria-hidden="true" />}
      </button>

      {open && hasDetail && (
        <div className="act-detail">
          {args.map(({ key, value }) => (
            <div key={key} className="act-field">
              <span className="act-key">{key}</span>
              <pre className="act-value">{value}</pre>
            </div>
          ))}
          {act.output !== undefined && act.output !== "" && (
            <div className="act-field">
              <span className={`act-key${failed ? " failed" : ""}`}>{failed ? "error" : "result"}</span>
              <pre className="act-value">{act.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Activity({ acts }: { acts: Act[] }) {
  return (
    <div className="activity">
      {acts.map((act) => (
        <Row key={act.id} act={act} />
      ))}
    </div>
  );
}
