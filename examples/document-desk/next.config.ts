import type { NextConfig } from "next";

/**
 * The environment packages must stay OUT of the bundle.
 *
 * Scripts run in worker threads, and the pool locates its worker entry
 * relative to its own module URL. Bundled, that URL points into a Next chunk
 * and the file it needs is not beside it — the failure surfaces at the first
 * script run, which is a poor place to find out. Keeping them as real files in
 * node_modules is what makes the probe work.
 *
 * `sharp` (via env:images) is native and must be external for its own reasons;
 * `pdfjs-dist` ships its own worker and dislikes being rewritten.
 */
const EXTERNAL = [
  "glove-working-environment",
  "glove-env-documents",
  "glove-env-spreadsheets",
  "glove-env-images",
  "glove-env-slides",
  "glove-env-archives",
  "sharp",
  "pdfjs-dist",
];

/**
 * Workspace packages need the explicit external below as well.
 *
 * `serverExternalPackages` is matched against the RESOLVED path, and Next
 * resolves it with `symlinks: true` hardcoded. pnpm links a workspace
 * dependency to ../../packages/<name>, which contains no `node_modules`
 * segment, so the match never fires and the package is bundled anyway — the
 * error you get is `Can't resolve './worker-dev.mjs'`, several layers from the
 * cause. Naming them here bypasses the path heuristic entirely.
 *
 * An app installing these from npm needs only the list above; this second
 * block is a monorepo tax.
 */
const WORKSPACE_LINKED = EXTERNAL.filter((p) => p.startsWith("glove-"));

const nextConfig: NextConfig = {
  serverExternalPackages: EXTERNAL,
  webpack: (config, { isServer }) => {
    if (!isServer) return config;
    const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
    config.externals = [
      // ESM externals: these packages are "type": "module", so they have to be
      // imported rather than required.
      (
        { request }: { request?: string },
        callback: (err?: unknown, result?: string) => void,
      ) => {
        const external =
          request && WORKSPACE_LINKED.some((pkg) => request === pkg || request.startsWith(`${pkg}/`));
        return external ? callback(undefined, `module ${request}`) : callback();
      },
      ...existing,
    ];
    return config;
  },
};

export default nextConfig;
