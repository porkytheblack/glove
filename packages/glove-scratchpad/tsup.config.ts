import { defineConfig } from "tsup";

export default defineConfig({
  // Keep `node:` on builtin imports. tsup strips it by default, and a
  // bare `zlib`/`vm`/`fs` resolves from node_modules — where real packages
  // with those names exist. The prefix is what makes that shadowing
  // impossible.
  removeNodeProtocol: false,
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
