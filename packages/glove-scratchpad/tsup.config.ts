import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/db/index.ts",
    "src/db/mcp.ts",
    "src/fns/index.ts",
    "src/fns/mcp.ts",
    "src/backends/memory.ts",
    "src/backends/pglite.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: ["glove-core", "zod", "@electric-sql/pglite", "glove-mcp", "glove-sql"],
});
