import "server-only";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { foundry } from "glove-foundry-web-kit/server";

// The example's own host code (lib/), loaded by Node rather than bundled by
// Next: it runs Foundry discovery to bind its file ids, opens SQLite memory
// and reads the account store on /data, like the scripts do. tsx compiles it,
// as it does for Foundry itself.

type Host = typeof import("../../lib/host");

const cache = globalThis as typeof globalThis & { __crewHost?: Promise<Host> };

export function host(): Promise<Host> {
  cache.__crewHost ??= (async () => {
    const { register } = await import(/* webpackIgnore: true */ "tsx/esm/api") as { register: () => unknown };
    register();
    return await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), "lib", "host.ts")).href) as Host;
  })();
  return cache.__crewHost;
}

/** Bots, the star, apps and skills, written through the Foundry client. */
export async function writes() {
  return (await host()).connect.writesVia.client(foundry());
}

/** Posting messages, through the Foundry client. */
export async function chats() {
  return (await host()).groups.chatsVia.client(foundry());
}
