import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Glove packages ship as ESM/TS — let Next transpile them.
  transpilePackages: ["glove-core", "glove-mesh", "glove-next"],
  // The model SDKs are dynamically imported by glove-core's adapters on the
  // server only; glove-voice is browser-only (AudioWorklet / Web Audio); PGlite
  // ships WASM assets that must load from disk. Keep them external so Next
  // doesn't try to bundle them server-side.
  serverExternalPackages: ["@anthropic-ai/sdk", "openai", "@electric-sql/pglite", "glove-voice"],
};

export default nextConfig;
