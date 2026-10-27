import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dataDir, dataPath } from "./paths.js";

// What the partner did in the world: messages sent, invoices paid, documents
// signed, files deleted, people notified. Offline it is a JSON-lines file;
// each entry is where your provider call goes.

export type Entry = { readonly kind: string } & Record<string, unknown>;

export async function record(entry: Entry): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await appendFile(dataPath("ledger.jsonl"), `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
}

export async function entries(kind?: string): Promise<Entry[]> {
  try {
    const lines = (await readFile(dataPath("ledger.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as Entry).filter((entry) => !kind || entry.kind === kind);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}
