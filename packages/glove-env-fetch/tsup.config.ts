import { defineConfig } from "tsup";

export default defineConfig({
  removeNodeProtocol: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  outDir: "dist",
});
