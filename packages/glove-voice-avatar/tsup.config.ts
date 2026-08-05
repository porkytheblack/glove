import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  outDir: "dist",
  external: ["eventemitter3", "glove-voice-s2s"],
});
