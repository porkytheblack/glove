import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { host: "127.0.0.1", port: 4242 },
  execution: {
    pollIntervalMs: 50,
    maxConcurrent: 4,
  },
  observability: { maxEvents: 5_000 },
});
