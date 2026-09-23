import { appendFile, writeFile } from "node:fs/promises";
import { defineApplication } from "../../src/application.js";
import { stationDaemon } from "../../src/station.js";

const events = process.env.FOUNDRY_TEST_RESOURCE_EVENTS!;
const box = { id: "test-box", backend: "test", createdAt: new Date().toISOString() };
export default defineApplication({
  name: "Unified daemon test",
  daemon: stationDaemon({
    stationId: "unified-test",
    async resources() {
      await appendFile(events, `setup:${process.pid}\n`);
      return { sandbox: {
        name: "test",
        capabilities: { filesystem: true, commands: true, isolated: false, pty: false },
        async create() { return box; }, async list() { return [box]; }, async get() { return box; }, async destroy() {},
        async exec() { throw new Error("Not exercised"); }, async command() { throw new Error("Not exercised"); }, async cancel() { throw new Error("Not exercised"); },
        async close() { await appendFile(events, "closed\n"); },
      } };
    },
    async onReady(connection) {
      if (process.env.FOUNDRY_TEST_RESOURCE_FAIL) throw new Error("Deliberate onReady failure");
      await writeFile(process.env.FOUNDRY_TEST_RESOURCE_CONNECTION!, JSON.stringify(connection), { mode: 0o600 });
    },
  }),
});
