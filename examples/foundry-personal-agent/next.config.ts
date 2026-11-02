import type { NextConfig } from "next";

const config: NextConfig = {
  // The kit is TypeScript source in the workspace.
  transpilePackages: ["glove-foundry-web-kit"],
  experimental: { externalDir: true },
  // No other site may frame the app: its buttons approve sends and hand over a browser.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default config;
