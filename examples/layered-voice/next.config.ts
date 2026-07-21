import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Glove packages ship as ESM/TS — let Next transpile them.
  transpilePackages: ["glove-core", "glove-mesh"],
  // The model SDKs are dynamically imported by glove-core's adapters on the
  // server only. Keep them external so Next doesn't try to bundle them.
  serverExternalPackages: ["@anthropic-ai/sdk", "openai", "better-sqlite3"],
};

export default nextConfig;
