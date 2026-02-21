import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server/index.ts", "src/silero-vad.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
  external: ["glove-core", "eventemitter3", "@ricky0123/vad-web", "onnxruntime-web"],
});
