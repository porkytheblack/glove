import { defineConfig } from "tsup";

export default defineConfig({
  removeNodeProtocol: false,
  entry: [
    "src/index.ts",
    "src/typesafe.ts",
    "src/llm.ts",
    "src/cascade.ts",
    "src/tools.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: ["glove-core", "zod"],
});
