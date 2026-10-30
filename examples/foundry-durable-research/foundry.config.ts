import { defineConfig } from "glove-foundry/config";
export default defineConfig({
  server: { host: "127.0.0.1", port: 4143 },
  execution: { maxConcurrent: 4, pollIntervalMs: 50 },
});
