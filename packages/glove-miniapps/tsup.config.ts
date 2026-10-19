import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/sqlite.ts", "src/postgres.ts", "src/foundry.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  removeNodeProtocol: false,
  external: ["effect"],
});
