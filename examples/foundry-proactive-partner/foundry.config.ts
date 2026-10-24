import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4147 },
  execution: { pollIntervalMs: 50, maxConcurrent: 4 },
});
