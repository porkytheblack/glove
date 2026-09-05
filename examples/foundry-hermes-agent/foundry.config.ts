import { defineConfig } from "glove-foundry/config";

const port = Number(process.env.PORT ?? process.env.FOUNDRY_PORT ?? 4244);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error("PORT or FOUNDRY_PORT must be an integer from 0 to 65535.");
}

export default defineConfig({
  server: { host: process.env.FOUNDRY_HOST ?? "127.0.0.1", port },
  execution: {
    pollIntervalMs: 50,
    idlePollIntervalMs: 250,
    maxConcurrent: 6,
    maxAttempts: 3,
    retryBackoffMs: 500,
  },
  observability: { maxEvents: 10_000 },
  strictFileRoutes: true,
});
