import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Mail that "arrives" in a sample account while the app runs: the demo page's
// mock mail puts it here (app/webhooks/mail), and demo/gmail-mcp.ts, which
// starts fresh for each run, reads it after the sample mailbox.

export interface Message { readonly id: string; readonly threadId: string; readonly from: string; readonly to: string; readonly subject: string; readonly body: string; readonly date: string; readonly labels: ReadonlyArray<string> }

const arrivedFile = (dataDir: string, account: string) => join(dataDir, `gmail-arrived-${account}.json`);

export async function arrived(dataDir: string, account: string): Promise<Message[]> {
  try { return JSON.parse(await readFile(arrivedFile(dataDir, account), "utf8")) as Message[]; } catch { return []; }
}

/** New mail for a sample account, as if it had just arrived. */
export async function arrive(
  dataDir: string,
  account: string,
  message: { readonly id: string; readonly threadId: string; readonly from: string; readonly subject: string; readonly body: string; readonly receivedAt: string; readonly labels: ReadonlyArray<string> },
): Promise<void> {
  const { receivedAt, ...rest } = message;
  await mkdir(dataDir, { recursive: true });
  await writeFile(arrivedFile(dataDir, account), JSON.stringify([...(await arrived(dataDir, account)), { ...rest, to: account, date: receivedAt }], null, 2));
}
