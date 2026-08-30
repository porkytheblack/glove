import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4141 },
  execution: { pollIntervalMs: 100, maxConcurrent: 4 },
});
