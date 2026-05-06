import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "server/index": "src/server/index.ts",
    "adapters/index": "src/adapters/index.ts",
  },
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  splitting: false,
  outDir: "dist",
})
