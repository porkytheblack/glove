import type { NextConfig } from "next";

const config: NextConfig = {
  // The kit is TypeScript source in the workspace.
  transpilePackages: ["glove-foundry-web-kit"],
  experimental: { externalDir: true },
};

export default config;
