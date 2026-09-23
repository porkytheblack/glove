import { StationClient } from "station-client";
import { BrowserUseClient } from "station-browser-use/client";
import type { BrowserSessionManager } from "station-browser-use";
import type { SandboxAdapter } from "station-sandbox";
import type { FoundryStationConnection } from "glove-foundry/station";
import { readState } from "./state.js";

/** The console talks to Foundry's daemon; it never creates another Station. */
export async function connectResources() {
  const connection = await readState<FoundryStationConnection | null>("worker-client.json", null);
  if (!connection) throw new Error("Foundry's daemon has not published its resource connection.");
  const client = new StationClient({ url: connection.url, token: connection.token });
  const browserClient = new BrowserUseClient({ baseUrl: connection.url, stationId: connection.stationId, apiKey: connection.token, access: "operator", timeoutMs: 60000 });
  const browser = {
    list: () => browserClient.request<ReturnType<BrowserSessionManager["list"]>>({ method: "list" }),
    perform: (id: string, action: "screenshot") => browserClient.request({ method: "action", id, action }),
    close: (id: string) => browserClient.request({ method: "close", id }),
  };
  const sandbox: Pick<SandboxAdapter, "list" | "exec" | "command"> & { services: NonNullable<SandboxAdapter["services"]> } = {
    list: () => client.execution(connection.stationId, "sandbox", { method: "list" }),
    exec: (id, options) => client.execution(connection.stationId, "sandbox", { method: "exec", id, ...options }),
    command: (id, runId) => client.execution(connection.stationId, "sandbox", { method: "command", id, runId }),
    services: id => client.execution(connection.stationId, "sandbox", { method: "services", id }),
  };
  let reaping: Promise<void> | undefined;
  const reapExpired = () => reaping ??= (async () => {
    const lifetime = Number(process.env.STEEL_SESSION_TIMEOUT_MS ?? 900000);
    for (const session of await browser.list()) {
      if (session.createdAt && Date.now() - Date.parse(session.createdAt) >= lifetime - 10000) await browser.close(session.id);
    }
  })().finally(() => { reaping = undefined; });
  return { browser, sandbox, reapExpired };
}
export type Resources = Awaited<ReturnType<typeof connectResources>>;
