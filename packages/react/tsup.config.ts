import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/adapters/index.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: ["react"],
});
