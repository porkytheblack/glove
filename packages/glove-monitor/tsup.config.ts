import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "cli-main": "src/cli-main.ts",
    "server/index": "src/server/index.ts",
    "adapters/index": "src/adapters/index.ts",
  },
  format: ["esm"],
  // Use a library-only tsconfig so the Next.js dashboard's incremental flag
  // (auto-restored by `next dev`/`next build` on the root tsconfig) doesn't
  // break tsup's DTS rollup pass.
  tsconfig: "./tsconfig.lib.json",
  dts: { resolve: true },
  target: "es2022",
  clean: true,
  splitting: false,
  outDir: "dist",
})
