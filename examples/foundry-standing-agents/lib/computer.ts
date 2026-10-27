import { readFile } from "node:fs/promises";
import { dataPath } from "./paths.js";

// The files on a dot's or a builder's computer. Foundry's data adapter keeps
// each computer in .data/foundry.json (foundryDataEnvironmentPersistence,
// scope "agent"), next to the instances, on the same disk. This only reads
// that file; the computer itself is written by its runs.

export interface ComputerFile {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: string;
}

interface Owner { readonly id: string; readonly definitionId: string; readonly workspaceId: string }
interface Saved {
  readonly workingEnvironments?: ReadonlyArray<{
    readonly owner: { readonly scope: string; readonly workspaceId: string; readonly definitionId: string; readonly agentId: string };
    readonly snapshot: { readonly files?: ReadonlyArray<{ readonly path: string; readonly data: string; readonly mtime: number }> };
  }>;
}

const GENERATED = ["/std", "/skills", "/.env"];

async function filesOf(agent: Owner) {
  let saved: Saved;
  try {
    saved = JSON.parse(await readFile(dataPath("foundry.json"), "utf8")) as Saved;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const computer = saved.workingEnvironments?.find(({ owner }) =>
    owner.scope === "agent" && owner.agentId === agent.id && owner.workspaceId === agent.workspaceId && owner.definitionId === agent.definitionId);
  // The environment writes its own docs (/std, /skills) and keeps secrets in /.env: none of that is the agent's work.
  return (computer?.snapshot.files ?? []).filter((file) => !GENERATED.some((dir) => file.path === dir || file.path.startsWith(`${dir}/`)));
}

/** What is on an agent's computer, newest first. */
export async function computerFiles(agent: Owner): Promise<ComputerFile[]> {
  return (await filesOf(agent))
    .map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.data, "base64"), modifiedAt: new Date(file.mtime).toISOString() }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** One file's contents, or undefined. */
export async function computerFile(agent: Owner, path: string): Promise<Buffer | undefined> {
  const file = (await filesOf(agent)).find((item) => item.path === path);
  return file ? Buffer.from(file.data, "base64") : undefined;
}
