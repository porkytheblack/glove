import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["glove-react", "glove-core"],
  async redirects() {
    return [
      { source: "/docs/glovebox", destination: "/foundry/docs/deploy", permanent: true },
      { source: "/docs/showcase/glovebox", destination: "/foundry/docs/deploy", permanent: true },
    ];
  },
};

export default nextConfig;
