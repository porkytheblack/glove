import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The sample mailbox behind demo/gmail-mcp.ts: Ada's inbox from fixtures/,
// plus mail that "arrives" during a run, kept in the data folder so the
// server, which starts fresh for each run, sees it.

export interface SampleMessage {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly labels: ReadonlyArray<string>;
}

const arrivedFile = (dataDir: string, account: string) => join(dataDir, `gmail-arrived-${account}.json`);

export async function sampleMailbox(dataDir: string, account: string): Promise<SampleMessage[]> {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/inbox.json", import.meta.url), "utf8")) as Array<Omit<SampleMessage, "threadId" | "labels">>;
  let arrived: SampleMessage[] = [];
  try { arrived = JSON.parse(await readFile(arrivedFile(dataDir, account), "utf8")); } catch { /* none yet */ }
  return [...fixture.map((message) => ({ ...message, threadId: message.id.replace("m-", "t-"), labels: ["INBOX"] })), ...arrived];
}

/** New mail for a sample account, as if it had just arrived. */
export async function arrive(dataDir: string, account: string, message: SampleMessage): Promise<void> {
  let arrived: SampleMessage[] = [];
  try { arrived = JSON.parse(await readFile(arrivedFile(dataDir, account), "utf8")); } catch { /* none yet */ }
  await mkdir(dataDir, { recursive: true });
  await writeFile(arrivedFile(dataDir, account), JSON.stringify([...arrived, message], null, 2));
}
