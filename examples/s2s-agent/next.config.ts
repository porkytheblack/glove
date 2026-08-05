import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Glove packages ship as ESM — let Next transpile them for the client bundle.
  transpilePackages: ["glove-core", "glove-voice-s2s"],
};

export default nextConfig;
