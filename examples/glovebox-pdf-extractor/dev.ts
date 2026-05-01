/**
 * Local dev runner. Boots the same `startGlovebox` machinery the built artifact
 * uses, but against a temp manifest derived from the wrap module — no docker,
 * no `glovebox build` required.
 *
 *   pnpm --filter glovebox-pdf-extractor dev
 *
 * Reads ANTHROPIC_API_KEY and GLOVEBOX_KEY from the environment. If GLOVEBOX_KEY
 * is unset a random one is generated and printed once on boot.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";

import { startGlovebox } from "glovebox-kit";
import type { Manifest } from "glovebox/protocol";
import gloveboxApp from "./glovebox";
// Re-import the agent so we can rebuild it pointing at temp paths instead of
// /input, /output, /work (which don't exist on a developer's host).
import { buildAgent } from "./agent";
import { glovebox } from "glovebox";

function fingerprint(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}...${h.slice(-4)}`;
}

async function main() {
  const port = Number(process.env.GLOVEBOX_PORT ?? 8080);
  const key = process.env.GLOVEBOX_KEY ?? randomBytes(24).toString("hex");
  if (!process.env.GLOVEBOX_KEY) {
    console.log(`[dev] GLOVEBOX_KEY not set — generated one for this run:\n  ${key}\n`);
  }

  // Re-point the filesystem at a temp dir so we don't need /input, /output, /work.
  const root = await mkdtemp(path.join(tmpdir(), "glovebox-pdf-extractor-"));
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  const workDir = path.join(root, "work");
  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(workDir, { recursive: true }),
  ]);

  // Build a fresh agent pointed at the temp paths and re-wrap it with the same
  // config but with the temp filesystem layout.
  const cfg = gloveboxApp.config;
  const devAgent = buildAgent({
    dbPath: path.join(workDir, "glove.db"),
    sessionId: "dev",
    paths: { input: inputDir, output: outputDir, work: workDir },
  });
  const devApp = glovebox.wrap(devAgent, {
    name: cfg.name,
    version: cfg.version,
    base: cfg.base,
    packages: cfg.packages,
    fs: {
      input: { path: inputDir, writable: false },
      output: { path: outputDir, writable: true },
      work: { path: workDir, writable: true },
    },
    env: cfg.env,
    storage: { inputs: cfg.storage.inputs, outputs: cfg.storage.outputs },
    limits: cfg.limits,
  });

  // Synthesize a manifest the kit can verify against.
  const manifest: Manifest = {
    name: devApp.config.name,
    version: devApp.config.version,
    base: devApp.config.base,
    fs: devApp.config.fs,
    env: devApp.config.env,
    limits: devApp.config.limits,
    key_fingerprint: fingerprint(key),
    storage_policy: devApp.config.storage,
    packages: devApp.config.packages,
    protocol_version: 1,
  };
  const manifestPath = path.join(root, "glovebox.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const running = await startGlovebox({
    app: devApp,
    port,
    key,
    manifestPath,
    publicBaseUrl: process.env.GLOVEBOX_PUBLIC_URL,
  });

  console.log(`[dev] glovebox listening on ws://localhost:${port}`);
  console.log(`[dev] input dir:  ${inputDir}`);
  console.log(`[dev] output dir: ${outputDir}`);
  console.log(`[dev] work dir:   ${workDir}`);

  const shutdown = async () => {
    console.log("[dev] shutting down…");
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[dev] failed to start:", err);
  process.exit(1);
});
