import { defineConfig } from "tsup";

export default defineConfig({
  // Keep `node:` on builtin imports. tsup strips it by default, and a
  // bare `zlib`/`vm`/`fs` resolves from node_modules — where real packages
  // with those names exist. The prefix is what makes that shadowing
  // impossible.
  removeNodeProtocol: false,
  // `src/raster.ts` is a second entry, not an accident: env:ocr rasterizes PDF
  // pages through the SAME pdfjs+canvas path this adapter uses, rather than
  // standing up a second one that would drift from it.
  entry: ["src/index.ts", "src/raster.ts"],
  format: ["esm"],
  dts: true,
  target: "es2022",
  clean: true,
  outDir: "dist",
});
