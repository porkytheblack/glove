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
    "src/entity/index.ts",
    "src/episodic/index.ts",
    "src/resources/index.ts",
    "src/context/index.ts",
    "src/forms/index.ts",
    "src/tools/index.ts",
    "src/layered/index.ts",
    "src/in-memory/index.ts",
  ],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: true,
  outDir: "dist",
});
