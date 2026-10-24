import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FoundryWorkingEnvironmentPersistenceAdapter } from "glove-foundry";
import type { EnvSnapshot } from "glove-working-environment";
import { dataPath } from "./paths.js";

const WORKSPACES = dataPath("workspaces");

/**
 * Saves a worker's files between runs. Each mesh thread is its own
 * conversation, so each task gets its own workspace, and a follow-up on the
 * same thread finds the files it left.
 */
export const fileWorkspaces: FoundryWorkingEnvironmentPersistenceAdapter = {
  identifier: "layered-assistant-workspaces",
  async load({ conversationId }) {
    try {
      return JSON.parse(await readFile(fileFor(conversationId), "utf8")) as EnvSnapshot;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  },
  async save(snapshot, { conversationId }) {
    await mkdir(WORKSPACES, { recursive: true });
    const file = fileFor(conversationId);
    await writeFile(`${file}.tmp`, JSON.stringify(snapshot));
    await rename(`${file}.tmp`, file);
  },
};

function fileFor(conversationId: string): string {
  return join(WORKSPACES, `${createHash("sha256").update(conversationId).digest("hex").slice(0, 32)}.json`);
}
