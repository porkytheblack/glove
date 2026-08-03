import { defineConfig } from "tsup";

export default defineConfig({
  // Keep `node:` on builtin imports. tsup strips it by default, and a
  // bare `zlib`/`vm`/`fs` resolves from node_modules — where real packages
  // with those names exist. The prefix is what makes that shadowing
  // impossible.
  removeNodeProtocol: false,
  entry: [
    "src/index.ts",
    "src/core.ts",
    "src/glove.ts",
    "src/extensions.ts",
    "src/content-skills.ts",
    "src/content-skills-fs.ts",
    "src/display-manager.ts",
    "src/tools/task-tool.ts",
    "src/tools/inbox-tool.ts",
    "src/models/anthropic.ts",
    "src/models/anthropic-compat.ts",
    "src/models/bedrock.ts",
    "src/models/openai-compat.ts",
    "src/models/mimo.ts",
    "src/models/providers.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
});
