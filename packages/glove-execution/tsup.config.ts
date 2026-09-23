import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/station.ts"], format: ["esm"], dts: true,
  target: "es2022", clean: true, splitting: true, removeNodeProtocol: false,
  external: ["glove-core", "glove-js", "zod", "station-browser-use", "station-client", "station-sandbox"],
});
