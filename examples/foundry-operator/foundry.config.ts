import { defineConfig } from "glove-foundry/config";
import { port } from "./lib/settings.js";
export default defineConfig({
  server: { host: "127.0.0.1", port: port + 2 },
  execution: { maxConcurrent: 1, maxAttempts: 1, pollIntervalMs: 50 },
  observability: { maxEvents: 3000 },
});
