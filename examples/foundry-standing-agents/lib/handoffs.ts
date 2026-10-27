import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dataDir, dataPath } from "./paths.js";

// Hand-offs: actions auto-review gave back to the person, under a rule of
// "hand off to you" or built-in safety. The dot tells the person where their
// routing says (a Slack DM here); this list is what the person can look back
// at and clear, on the web app's Activity screen. One line per hand-off in
// .data/handoffs.jsonl, and one per hand-off the person marked done.

export interface HandOff {
  readonly id: string;
  readonly agentId: string;
  readonly workspaceId: string;
  /** The rule's name, like merge_pr. */
  readonly action: string;
  /** What the person should do, from the action's handOff(). */
  readonly todo: string;
  /** Built-in safety, rather than the person's own rule. */
  readonly builtIn: boolean;
  readonly at: string;
}

type Line = ({ readonly kind: "handoff" } & HandOff) | { readonly kind: "done"; readonly id: string; readonly at: string };

const FILE = () => dataPath("handoffs.jsonl");

async function lines(): Promise<Line[]> {
  try {
    return (await readFile(FILE(), "utf8")).split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as Line];
      } catch {
        return [];
      }
    });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}

async function append(line: Line): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await appendFile(FILE(), `${JSON.stringify(line)}\n`);
}

/** Called by auto-review when it hands an action to the person. */
export async function recordHandOff(entry: Omit<HandOff, "id" | "at">): Promise<HandOff> {
  const handOff: HandOff = { ...entry, id: randomUUID(), at: new Date().toISOString() };
  await append({ kind: "handoff", ...handOff });
  return handOff;
}

/** The hand-offs of these agents the person hasn't marked done, newest first. */
export async function openHandOffs(agentIds: ReadonlyArray<string>): Promise<HandOff[]> {
  const all = await lines();
  const done = new Set(all.flatMap((line) => line.kind === "done" ? [line.id] : []));
  return all
    .flatMap((line) => line.kind === "handoff" && agentIds.includes(line.agentId) && !done.has(line.id) ? [stripKind(line)] : [])
    .reverse();
}

/** One hand-off, by id. */
export async function handOffById(id: string): Promise<HandOff | undefined> {
  const line = (await lines()).find((item) => item.kind === "handoff" && item.id === id);
  return line?.kind === "handoff" ? stripKind(line) : undefined;
}

export async function markDone(id: string): Promise<void> {
  await append({ kind: "done", id, at: new Date().toISOString() });
}

function stripKind({ kind: _kind, ...handOff }: { readonly kind: "handoff" } & HandOff): HandOff {
  return handOff;
}
