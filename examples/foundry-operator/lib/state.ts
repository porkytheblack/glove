import { readFile, writeFile, rename, mkdir, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { stateDir, prepareState } from "./settings.js";
export async function readState<T>(name: string, fallback: T, directory = stateDir): Promise<T> {
  try { return JSON.parse(await readFile(join(directory, name), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
export async function writeState(name: string, data: unknown, directory = stateDir) {
  if (directory === stateDir) prepareState();
  else { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }
  const file = join(directory, name), temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
  await rename(temp, file);
}
export interface Grants { browserIds: string[]; sandboxIds: string[] }
export const readGrants = () => readState<Grants>("grants.json", { browserIds: [], sandboxIds: [] });
