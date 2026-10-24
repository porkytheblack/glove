import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FoundryWorkingEnvironmentPersistenceAdapter } from "glove-foundry";
import type { EnvSnapshot } from "glove-working-environment";
import { dataPath } from "./paths.js";

/**
 * A worker's computer is saved per instance, not per task: files the builder
 * wrote for last week's report are still there this week. In production, swap
 * this for a Kuiper sandbox (see the README).
 */
export const perInstance: FoundryWorkingEnvironmentPersistenceAdapter = {
  identifier: "dots-computers",
  async load({ agentId }) {
    try {
      return JSON.parse(await readFile(fileFor(agentId), "utf8")) as EnvSnapshot;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  },
  async save(snapshot, { agentId }) {
    await mkdir(dataPath("computers"), { recursive: true });
    const file = fileFor(agentId);
    await writeFile(`${file}.tmp`, JSON.stringify(snapshot));
    await rename(`${file}.tmp`, file);
  },
};

export function fileFor(agentId: string): string {
  return join(dataPath("computers"), `${createHash("sha256").update(agentId).digest("hex").slice(0, 32)}.json`);
}
