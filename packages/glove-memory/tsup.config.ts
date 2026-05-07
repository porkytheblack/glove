import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/entity/index.ts",
    "src/episodic/index.ts",
    "src/tools/index.ts",
    "src/in-memory/index.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
});
