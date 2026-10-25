import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import type { SecretStore } from "glove-env-secret";
import { dataDir, dataPath } from "./paths.js";

// The logins a person gives Muse: a site and the credential it expects. The
// person enters them in your app; Muse can use one by name on that site's
// origin, but its scripts can never read the value (glove-env-secret keeps
// get() off, and env:fetch adds the header outside the sandbox). Kept apart
// from everything else, in a file only this process user can read.

export interface Login {
  /** Where the credential may be sent, like https://bistro-luna.example. */
  readonly origin: string;
  readonly value: string;
  /** How the site expects it. */
  readonly header?: string;
  readonly prefix?: string;
}

type Vault = Record<string, Record<string, Login>>;

const file = () => dataPath("vault.json");

async function readVault(): Promise<Vault> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Vault;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw cause;
  }
}

async function writeVault(vault: Vault): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${file()}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(vault, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  await rename(temporary, file());
}

/** Your app's "Add a login" form: the person types it, Muse never sees it. */
export async function saveLogin(person: string, name: string, login: Login): Promise<void> {
  const vault = await readVault();
  await writeVault({ ...vault, [person]: { ...vault[person], [name]: login } });
}

export async function loginsOf(person: string): Promise<Readonly<Record<string, Login>>> {
  return (await readVault())[person] ?? {};
}

/** One person's logins as a keystore for the working environment. Writes stay in your app. */
export function vaultFor(person: string): SecretStore {
  return {
    get: async (name) => (await loginsOf(person))[name]?.value ?? null,
    list: async () => Object.keys(await loginsOf(person)),
    set: async () => { throw new Error("Logins are added by the person, in the app."); },
    delete: async () => { throw new Error("Logins are removed by the person, in the app."); },
  };
}
