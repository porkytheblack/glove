import { mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import type { GloveboxApp } from "../config"
import { generateDockerfile, resolveBaseImage } from "./dockerfile"
import { ensureAuthKey } from "./key"
import { generateEnvExample, generateManifest } from "./manifest"
import { generateNixpacks } from "./nixpacks"
import { emitServerBundle } from "./server-bundle"

export interface BuildArgs {
  /** Absolute path to the developer's wrap module (default-exports a GloveboxApp). */
  entry: string
  /** Output directory. Defaults to `<entry-dir>/dist`. */
  outDir?: string
  /** Optional override of the app name. */
  name?: string
}

export interface BuildResult {
  outDir: string
  baseImage: string
  keyFingerprint: string
  packages: { apt: number; pip: number; npm: number }
}

export async function build(args: BuildArgs): Promise<BuildResult> {
  const entry = path.resolve(args.entry)
  const entryDir = path.dirname(entry)
  const outDir = path.resolve(args.outDir ?? path.join(entryDir, "dist"))

  const mod = await import(pathToFileURL(entry).href)
  const app: GloveboxApp | undefined = mod.default ?? mod.app
  if (!app || (app as GloveboxApp).__glovebox !== 1) {
    throw new Error(
      `Entry ${entry} did not default-export a GloveboxApp. Did you call glovebox.wrap(...)?`,
    )
  }

  const config = { ...app.config }
  if (args.name) config.name = args.name

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const keyPath = path.join(outDir, "glovebox.key")
  const { fingerprint } = await ensureAuthKey(keyPath)

  const dockerfile = generateDockerfile(config)
  const nixpacks = generateNixpacks(config)
  const manifest = generateManifest({ config, keyFingerprint: fingerprint })
  const envExample = generateEnvExample(config)

  await writeFile(path.join(outDir, "Dockerfile"), dockerfile)
  await writeFile(path.join(outDir, "nixpacks.toml"), nixpacks)
  await writeFile(path.join(outDir, "glovebox.json"), JSON.stringify(manifest, null, 2) + "\n")
  await writeFile(path.join(outDir, ".env.example"), envExample)

  const serverDir = path.join(outDir, "server")
  await emitServerBundle({ wrapEntry: entry, outDir: serverDir, appName: config.name })
  // The runtime expects glovebox.json next to index.js so import.meta.url
  // resolution works.
  await writeFile(
    path.join(serverDir, "glovebox.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  )

  return {
    outDir,
    baseImage: resolveBaseImage(config.base),
    keyFingerprint: fingerprint,
    packages: {
      apt: config.packages.apt?.length ?? 0,
      pip: config.packages.pip?.length ?? 0,
      npm: config.packages.npm?.length ?? 0,
    },
  }
}
