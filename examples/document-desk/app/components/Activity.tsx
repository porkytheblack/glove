"use client";

/**
 * The verbs, rendered inline in the transcript.
 *
 * One line per call, tinted by what it does to the tree — the point is that
 * you can glance at a turn and see whether the agent was orienting itself,
 * writing, or running something, without reading any of it.
 */
import type { Entry } from "@/lib/useDesk";

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
    default:
      return str("path");
  }
}

export function Activity({ acts }: { acts: Extract<Entry, { kind: "act" }>[] }) {
  return (
    <div className="activity">
      {acts.map((act) => {
        const tint = TINT[act.name] ?? "";
        const failed = act.status === "error";
        return (
          <div
            key={act.id}
            className={`act ${failed ? "danger failed" : tint} ${act.status === "running" ? "running" : ""}`}
            title={failed ? act.output : undefined}
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
          </div>
        );
      })}
    </div>
  );
}
