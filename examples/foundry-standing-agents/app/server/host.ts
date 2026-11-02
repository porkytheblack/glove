import "server-only";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The example's own host code (lib/), loaded by Node rather than bundled by
// Next: it runs Foundry discovery to bind its file ids, and reads the dot's
// hand-offs and computer files on /data, like the scripts do. tsx compiles
// it, as it does for Foundry itself.

type Host = typeof import("../../lib/host");

const cache = globalThis as typeof globalThis & { __dotHost?: Promise<Host> };

export function host(): Promise<Host> {
  cache.__dotHost ??= (async () => {
    const { register } = await import(/* webpackIgnore: true */ "tsx/esm/api") as { register: () => unknown };
    register();
    return await import(/* webpackIgnore: true */ pathToFileURL(join(process.cwd(), "lib", "host.ts")).href) as Host;
  })();
  return cache.__dotHost;
}
