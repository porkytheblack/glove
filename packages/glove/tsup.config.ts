import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core.ts",
    "src/glove.ts",
    "src/display-manager.ts",
    "src/tools/task-tool.ts",
    "src/models/anthropic.ts",
    "src/models/bedrock.ts",
    "src/models/openai-compat.ts",
    "src/models/providers.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
});
