import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Glove packages ship as ESM/TS — let Next transpile them.
  transpilePackages: ["glove-core", "glove-mesh", "glove-next"],
  // The model SDKs are dynamically imported by glove-core's adapters on the
  // server only; glove-voice is browser-only (AudioWorklet / Web Audio). Keep
  // them external so Next doesn't try to bundle them server-side.
  serverExternalPackages: ["@anthropic-ai/sdk", "openai", "better-sqlite3", "glove-voice"],
};

export default nextConfig;
