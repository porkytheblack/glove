import { defineConfig } from "glove-foundry/config";

export default defineConfig({
  // Loopback only: the web app's server is the only caller.
  server: { host: "127.0.0.1", port: 4310 },
  execution: { pollIntervalMs: 40, maxConcurrent: 4 },
});
