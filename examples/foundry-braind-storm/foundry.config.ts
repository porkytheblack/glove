import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { host: "127.0.0.1", port: 4260 },
  execution: { pollIntervalMs: 40, maxConcurrent: 4 },
  observability: { maxEvents: 20_000 },
});
