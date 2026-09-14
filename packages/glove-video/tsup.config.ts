import { defineConfig } from "tsup";

export default defineConfig({
  removeNodeProtocol: false,
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/pipeline/index.ts",
    "src/flows/index.ts",
    "src/tools/index.ts",
    "src/in-memory/index.ts",
    "src/openrouter/index.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: ["glove-core", "zod"],
});
