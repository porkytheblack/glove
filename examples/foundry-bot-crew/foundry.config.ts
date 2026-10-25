import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4143 },
  // The main bot and three others can all be at work at once.
  execution: { pollIntervalMs: 50, maxConcurrent: 6 },
});
