import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineWorkingEnvironment, type FoundryWorkingEnvironmentPersistenceAdapter } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";
import type { EnvSnapshot } from "glove-working-environment";
import { dataPath } from "../../lib/paths.js";

/**
 * One computer per person, shared by all their bots: files one bot writes,
 * another can read. It is saved per workspace, and the workspace is the
 * person. On Kuiper, a sandbox and a browser per person replace it.
 */
const perPerson: FoundryWorkingEnvironmentPersistenceAdapter = {
  identifier: "bot-crew-computers",
  async load({ workspaceId }) {
    try {
      return JSON.parse(await readFile(fileFor(workspaceId), "utf8")) as EnvSnapshot;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  },
  async save(snapshot, { workspaceId }) {
    await mkdir(dataPath("computers"), { recursive: true });
    const file = fileFor(workspaceId);
    await writeFile(`${file}.tmp`, JSON.stringify(snapshot));
    await rename(`${file}.tmp`, file);
  },
};

function fileFor(workspaceId: string): string {
  return join(dataPath("computers"), `${createHash("sha256").update(workspaceId).digest("hex").slice(0, 32)}.json`);
}

export const computer = defineWorkingEnvironment({
  options: { stdlib: [fetchFiles({ maxResponseBytes: 2_000_000 })] },
  persistence: perPerson,
});
