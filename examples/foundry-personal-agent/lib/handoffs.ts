import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dataDir, dataPath } from "./paths.js";

// A browser handed to the person, waiting for them: host code only. When Muse
// calls browser.handOff, browser.ts sends Kuiper's interactive live view to
// the person on WhatsApp and keeps it here too, so their app's Watch screen
// can offer "Take over to sign in". The link takes clicks and keys in their
// browser, so it never goes into Muse's context, its instance or the log, and
// the web app only redirects the signed-in person to it. It is cleared when
// that browser session closes.

export interface PendingHandOff {
  readonly person: string;
  readonly agentId: string;
  /** The Kuiper session handed over. Host code only. */
  readonly sessionId: string;
  /** What Muse needs the person to do there. */
  readonly reason: string;
  /** Kuiper's interactive live view. Secret: it is the browser. */
  readonly url: string;
  /** The page the browser was on. */
  readonly page: { readonly url: string; readonly title: string };
  readonly at: string;
}

const file = () => dataPath("handoffs.json");

async function readAll(): Promise<Record<string, PendingHandOff>> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Record<string, PendingHandOff>;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw cause;
  }
}

/** Written whole and renamed into place, readable by this process user only. */
async function writeAll(value: Record<string, PendingHandOff>): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${file()}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  await rename(temporary, file());
}

/** Keep a person's hand-off. One per person: a newer one replaces it. */
export async function keepHandOff(handOff: Omit<PendingHandOff, "at">): Promise<void> {
  await writeAll({ ...await readAll(), [handOff.person]: { ...handOff, at: new Date().toISOString() } });
}

/** The person's pending hand-off, if any. */
export async function handOffOf(person: string): Promise<PendingHandOff | undefined> {
  return (await readAll())[person];
}

/** Forget it: the session closed, or (with no session id) whichever it was. */
export async function clearHandOff(person: string, sessionId?: string): Promise<void> {
  const all = await readAll();
  const current = all[person];
  if (!current || (sessionId && current.sessionId !== sessionId)) return;
  const { [person]: _gone, ...rest } = all;
  await writeAll(rest);
}
