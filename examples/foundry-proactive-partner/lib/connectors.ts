import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { GloveFoldArgs } from "glove-core";
import { z } from "zod";
import { dataDir, dataPath } from "./paths.js";

// your code: Gmail and Google Calendar (or any provider) behind the same two
// tools. Here the inbox is a JSON file seeded from fixtures/, so a check-in can
// find mail that arrived since the last one.

export interface Email {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly read?: boolean;
}

const MAILBOX = dataPath("mailbox.json");
const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url);

async function load(): Promise<Email[]> {
  try {
    return JSON.parse(await readFile(MAILBOX, "utf8")) as Email[];
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    return JSON.parse(await readFile(fixture("inbox.json"), "utf8")) as Email[];
  }
}

async function save(emails: Email[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(`${MAILBOX}.tmp`, JSON.stringify(emails, null, 2));
  await rename(`${MAILBOX}.tmp`, MAILBOX);
}

/** New mail arriving. `pnpm verify` uses it; a real connector would not. */
export async function deliver(email: Email): Promise<void> {
  await save([...(await load()), email]);
}

export const connectorTools: GloveFoldArgs<any>[] = [
  {
    name: "read_inbox",
    description: "Read mail you have not seen yet. Each email is returned once, then marked as seen.",
    inputSchema: z.object({}),
    async do() {
      const emails = await load();
      const unseen = emails.filter((email) => !email.read);
      await save(emails.map((email) => ({ ...email, read: true })));
      return { status: "success" as const, data: unseen.map(({ read: _read, ...email }) => email) };
    },
  },
  {
    name: "read_calendar",
    description: "Read today's calendar.",
    inputSchema: z.object({}),
    async do() {
      return { status: "success" as const, data: JSON.parse(await readFile(fixture("calendar.json"), "utf8")) };
    },
  },
];
