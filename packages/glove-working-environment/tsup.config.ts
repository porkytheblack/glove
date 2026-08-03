import { defineConfig } from "tsup";

export default defineConfig({
  // Keep `node:` on builtin imports. tsup strips it by default, and a
  // bare `zlib`/`vm`/`fs` resolves from node_modules — where real packages
  // with those names exist. The prefix is what makes that shadowing
  // impossible.
  removeNodeProtocol: false,
  // worker.ts must be its own entry, not bundled into a shared chunk: the
  // pool spawns it by URL (`new URL("./worker.js", import.meta.url)`), so it
  // has to exist as a real file next to the chunk that references it.
  entry: ["src/index.ts", "src/testing.ts", "src/executor/worker.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  outDir: "dist",
});
