import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4149 },
  execution: { pollIntervalMs: 50, maxConcurrent: 4 },
});
