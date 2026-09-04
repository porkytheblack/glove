import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { host: "127.0.0.1", port: 4244 },
  execution: {
    pollIntervalMs: 50,
    idlePollIntervalMs: 250,
    maxConcurrent: 6,
    maxAttempts: 3,
    retryBackoffMs: 500,
  },
  observability: { maxEvents: 10_000 },
  strictFileRoutes: true,
});
