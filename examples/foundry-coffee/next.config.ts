import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["glove-react", "glove-core", "glove-next"],
  // glove-voice pulls in onnxruntime for the Silero VAD; keep it out of the server bundle.
  serverExternalPackages: ["glove-voice", "glove-foundry"],
  // The Foundry side is plain ESM TypeScript with ".js" import specifiers.
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return webpackConfig;
  },
};

export default config;
