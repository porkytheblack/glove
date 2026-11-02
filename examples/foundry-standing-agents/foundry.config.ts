import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4145 },
  // Several dots, their research runs and a builder can all be at work at once.
  execution: { pollIntervalMs: 50, maxConcurrent: 6 },
});
