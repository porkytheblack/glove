import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  server: { port: 4142 },
  // The interactor, a call and two workers can all be busy at once.
  execution: { pollIntervalMs: 50, maxConcurrent: 6 },
});
