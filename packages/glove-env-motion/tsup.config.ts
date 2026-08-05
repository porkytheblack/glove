import { defineConfig } from "tsup";

const shared = {
  // Keep `node:` on builtin imports. tsup strips it by default, and a
  // bare `fs`/`url` resolves from node_modules — where real packages with
  // those names exist. The prefix makes that shadowing impossible.
  removeNodeProtocol: false,
  format: ["esm"] as const,
  target: "es2022" as const,
  outDir: "dist",
};

export default defineConfig([
  { ...shared, entry: ["src/index.ts"], dts: true, clean: true },
  // The doctor CLI is its own entry because the shebang must land on it and
  // nothing else.
  { ...shared, entry: ["src/doctor-cli.ts"], dts: false, clean: false, banner: { js: "#!/usr/bin/env node" } },
]);
