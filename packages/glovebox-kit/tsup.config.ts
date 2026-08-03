import { defineConfig } from "tsup"

export default defineConfig({
  // Keep `node:` on builtin imports. tsup strips it by default, and a
  // bare `zlib`/`vm`/`fs` resolves from node_modules — where real packages
  // with those names exist. The prefix is what makes that shadowing
  // impossible.
  removeNodeProtocol: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: false,
  outDir: "dist",
})
