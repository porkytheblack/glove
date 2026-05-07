import { defineConfig } from "tsup"

export default defineConfig([
  // Default Node entry — has DCR, fs cache, http
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    target: "es2022",
    clean: true,
    splitting: false,
    outDir: "dist",
    platform: "node",
  },
  // Browser entry — no node:* imports
  {
    entry: { "browser/index": "src/browser/index.ts" },
    format: ["esm"],
    dts: true,
    target: "es2022",
    clean: false,
    splitting: false,
    outDir: "dist",
    platform: "browser",
  },
  // Server-handler entry (Node, used in dev's backend route)
  {
    entry: { "server/index": "src/server/index.ts" },
    format: ["esm"],
    dts: true,
    target: "es2022",
    clean: false,
    splitting: false,
    outDir: "dist",
    platform: "node",
  },
])
