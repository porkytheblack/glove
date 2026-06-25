import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/tools/index.ts",
    "src/graph/index.ts",
    "src/backends/memory.ts",
    "src/backends/pglite.ts",
    "src/mcp/index.ts",
    "src/persist/index.ts",
    "src/persist/fs.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: ["glove-core", "zod", "@electric-sql/pglite", "glove-mcp"],
});
