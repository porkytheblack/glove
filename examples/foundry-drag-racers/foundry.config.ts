import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { host: "127.0.0.1", port: 4250 },
  execution: { pollIntervalMs: 40, maxConcurrent: 8 },
  observability: { maxEvents: 10_000 },
});
