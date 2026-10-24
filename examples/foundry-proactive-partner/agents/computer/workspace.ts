import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineWorkingEnvironment, type FoundryWorkingEnvironmentPersistenceAdapter } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";
import type { EnvSnapshot } from "glove-working-environment";
import { dataPath } from "../../lib/paths.js";

/**
 * The computer's files are saved per partner, not per task, so what it built
 * last week is still there. env:fetch gives it the public web. On Kuiper, a
 * sandbox and a browser per person replace this (see the README).
 */
const perPerson: FoundryWorkingEnvironmentPersistenceAdapter = {
  identifier: "partner-computers",
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

function fileFor(agentId: string): string {
  return join(dataPath("computers"), `${createHash("sha256").update(agentId).digest("hex").slice(0, 32)}.json`);
}

export const computer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: perPerson,
});
