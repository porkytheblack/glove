import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["glove-react", "glove-core", "glove-next"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
