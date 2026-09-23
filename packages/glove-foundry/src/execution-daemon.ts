/** A separate process owns Station's daemon, queue, schedules and child runners. */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createStation, MemoryKeyStorage, MemoryLogStorage, type StationInstance } from "station-daemon/server";
import { resolveConfig } from "station-daemon";
import { StationClient, StationApiError } from "station-client";
import { MemoryAdapter, configure, type AnySignal, type SignalSubscriber } from "station-signal";
import { ScheduleMemoryAdapter } from "station-schedules";
import { MemoryEnvStorage } from "station-env";
import type { FoundryApplication } from "./application.js";
import type { FoundryStationResources } from "./station.js";
import { FOUNDRY_APPLICATION_ENV, internalAgentName } from "./definition.js";
import { executionEvents, type DaemonRequest, type DaemonResponse } from "./execution-protocol.js";

let station: StationInstance | undefined;
let client: StationClient | undefined;
const queue = new MemoryAdapter();
const schedules = new ScheduleMemoryAdapter();
const definitions = new Map<string, AnySignal>();
let stopping: Promise<void> | undefined;
let resources: FoundryStationResources | undefined;
function send(message: DaemonResponse) { if (process.connected) process.send?.(message); }
async function stop() {
  return stopping ??= (async () => { if (station) await station.stop();
    else await Promise.allSettled([resources?.browser?.close(), resources?.sandbox?.close()]); })();
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No daemon port available.");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
process.on("message", (message: DaemonRequest) => {
  void (async () => {
    const command = message.command;
    let value: unknown;
    switch (command.method) {
      case "init": {
        if (station) throw new Error("Execution daemon is already initialized.");
        const options = command.options;
        const signals = join(options.directory, "signals");
        await mkdir(signals, { recursive: true, mode: 0o700 });
        await writeFile(join(signals, "package.json"), '{"type":"module"}', { mode: 0o600 });
        for (const [index, agent] of options.agents.entries()) {
          const entry = join(signals, `${index}.js`);
          await writeFile(entry,
            `import { loadExecutionAgent } from ${JSON.stringify(pathToFileURL(options.loader).href)};\nexport default await loadExecutionAgent(${JSON.stringify(agent.route)}, ${JSON.stringify(agent.filePath)});\n`, { mode: 0o600 });
          const signal = (await import(pathToFileURL(entry).href)).default as AnySignal;
          definitions.set(signal.name, signal);
        }
        const subscribers = Object.fromEntries(executionEvents.map(event => [event, (value: unknown) => send({ event, value })])) as SignalSubscriber;
        const applicationFile = process.env[FOUNDRY_APPLICATION_ENV];
        const application = applicationFile ? (await import(pathToFileURL(applicationFile).href)).default as FoundryApplication : undefined;
        const daemon = application?.daemon;
        if (daemon && daemon.kind !== "station") throw new Error("Unsupported daemon adapter.");
        const settings = daemon?.options;
        resources = await settings?.resources?.();
        const port = settings?.port ?? await freePort();
        station = await createStation(resolveConfig({
          host: "127.0.0.1", port, stationDir: join(options.directory, "station"),
          signalsDir: signals, adapter: queue, scheduleAdapter: schedules,
          ...(settings ? { network: { stationId: settings.stationId, name: settings.name ?? settings.stationId } } : {}),
          ...(resources ? { execution: { ...resources, token: randomBytes(32).toString("hex") } } : {}),
          envStorage: new MemoryEnvStorage(), logStorage: new MemoryLogStorage(),
          auth: { username: "foundry", password: randomBytes(32).toString("hex"), keyStorage: new MemoryKeyStorage() },
          subscribers: { signal: [subscribers] }, runner: options.runner,
        }), options.rootDir);
        const key = await station.keyStore!.create("foundry-execution", ["trigger", "read", "cancel"]);
        client = new StationClient({ url: `http://127.0.0.1:${port}`, token: key.key });
        await station.start();
        await client.connect();
        for (const agent of options.agents) {
          const name = internalAgentName(agent.route);
          await client.request("GET", `/signals/${encodeURIComponent(name)}`);
        }
        if (settings?.onReady) {
          // Station 3 requires operator/admin scope for its local resource gateway.
          // Expose this only to the trusted application callback, never model context.
          const resourceKey = await station.keyStore!.create("foundry-resources", ["admin"]);
          await settings.onReady({ url: `http://127.0.0.1:${port}`, stationId: settings.stationId, token: resourceKey.key });
        }
        configure({ adapter: queue });
        value = { pid: process.pid };
        break;
      }
      case "trigger": {
        const definition = definitions.get(command.name);
        if (!definition) throw new Error("Unknown agent definition.");
        // Native enqueue preserves schema validation, local wakeups and large
        // multimodal envelopes without the public HTTP API's 5 MiB body cap.
        value = await definition.trigger(command.input);
        break;
      }
      case "get": value = await queue.getRun(command.id); break;
      case "list": value = await queue.listAllRuns({ signalName: command.signalName }); break;
      case "cancel":
        try { await client!.request("POST", `/runs/${encodeURIComponent(command.id)}/cancel`, {}); value = true; }
        catch (error) { if (error instanceof StationApiError && ["cannot_cancel", "not_found"].includes(error.code)) value = false; else throw error; }
        break;
      case "schedule.add": await schedules.add(command.schedule); value = null; break;
      case "schedule.delete": value = await schedules.delete(command.id); break;
      case "ping": value = Boolean(client && (await client.health()).ok); break;
      case "stop": await stop(); value = null; break;
    }
    send({ id: message.id, value });
    if (command.method === "stop") process.disconnect?.();
  })().catch(() => {
    // Do not serialize arbitrary SDK/config errors (they may include credentials).
    send({ id: message.id, error: `Execution daemon ${message.command.method} failed. Inspect daemon health before repeating mutations.` });
  });
});
process.once("disconnect", () => { void stop().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
