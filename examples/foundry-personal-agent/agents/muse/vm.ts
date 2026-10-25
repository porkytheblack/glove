import { defineWorkingEnvironment, foundryDataEnvironmentPersistence } from "glove-foundry";
import { fetchFiles } from "glove-env-fetch";
import { secret, secretRef } from "glove-env-secret";
import { loginsOf, vaultFor } from "../../lib/vault.js";
import { offlineWeb } from "../../demo/web.js";
import { sentinelFor } from "./sentinel.js";

/**
 * Muse's own computer, one per person: files and scripts that last between
 * runs, and the web through env:fetch. Two things guard it:
 *
 * - the Sentinel decides every request and redirect before it leaves;
 * - the person's logins live in a vault Muse can use but not read. A script
 *   names a login (`credential: "bistro-luna"`) and env:fetch adds it on that
 *   site's origin only. env:secret lists the logins and hands out references,
 *   never values.
 *
 * On Kuiper, a sandbox and a browser per person take its place (see the README).
 */
export const vm = defineWorkingEnvironment({
  options: async ({ assembly }) => {
    const person = assembly.workspaceId;
    const vault = vaultFor(person);
    const logins = await loginsOf(person);
    const web = offlineWeb();
    return {
      stdlib: [
        secret({ store: vault }),
        fetchFiles({
          maxResponseBytes: 2_000_000,
          authorize: sentinelFor(assembly).authorize,
          secretStore: vault,
          credentials: Object.fromEntries(Object.entries(logins).map(([name, login]) => [name, {
            origins: [login.origin],
            headers: { [login.header ?? "Authorization"]: { ref: secretRef(name), prefix: login.prefix ?? "Bearer " } },
          }])),
          ...(web ? { fetch: web } : {}),
        }),
      ],
    };
  },
  persistence: foundryDataEnvironmentPersistence({ scope: "agent" }),
});
