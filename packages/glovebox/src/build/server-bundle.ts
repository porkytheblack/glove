import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import { build as esbuild, type Metafile } from "esbuild"

import {
  externalPatterns,
  packageNameOf,
  serverDependencies,
  stageExternals,
  type StageResult,
} from "./externals"

const requireFromHere = createRequire(import.meta.url)

/**
 * The server bundle dropped into `dist/server/` is a single ESM file,
 * `index.js`, plus the things that cannot go inside it.
 *
 * esbuild inlines glovebox-kit, glovebox-core, glove-core, and the developer's
 * wrap module — all ordinary JavaScript that does not care where it lives.
 * Two families stay out, for reasons `./externals.ts` documents in full:
 *
 * - `glove-working-environment` and `glove-env-*` resolve files relative to
 *   themselves (a worker thread opened by URL, pdf.js's font directory,
 *   motion's own React). They are vendored into `dist/server/vendor/` and
 *   copied into `node_modules` by the generated Dockerfile.
 * - native modules (better-sqlite3, sharp, @napi-rs/canvas, the ffmpeg
 *   installers, playwright-core, esbuild) are declared in the emitted
 *   `package.json` and installed inside the image, where npm resolves the
 *   binary for the image's platform.
 *
 * Only externals the bundle actually imports are emitted, read back from
 * esbuild's metafile — a media agent should not carry a Chromium dependency
 * because the external list mentions one.
 */
export interface ServerBundleArgs {
  /** Absolute path to the developer's wrap module (the file passed to `glovebox build`). */
  wrapEntry: string
  /** Output directory for the bundle (e.g. `dist/server`). */
  outDir: string
  /** Name field of the developer's app. */
  appName: string
  /**
   * True when the base image already carries a compiled better-sqlite3 under
   * /opt/glovebox-prebuilt, which the generated Dockerfile links in.
   */
  sqliteFromBaseImage: boolean
}

export interface ServerBundleResult extends StageResult {
  /** Registry dependencies written into the emitted `package.json`. */
  dependencies: Record<string, string>
}

const SYNTHETIC_ENTRY = (wrapEntry: string, kitEntry: string) => `import { startGlovebox } from ${JSON.stringify(kitEntry)}
import * as wrapModule from ${JSON.stringify(wrapEntry)}

const port = Number(process.env.GLOVEBOX_PORT ?? 8080)
const key = process.env.GLOVEBOX_KEY
if (!key) {
  console.error("GLOVEBOX_KEY is required")
  process.exit(1)
}

const app = wrapModule.default ?? wrapModule.app
if (!app || app.__glovebox !== 1) {
  console.error("Wrap module did not default-export a GloveboxApp")
  process.exit(1)
}

const adapters = typeof wrapModule.adapters === "function"
  ? await wrapModule.adapters()
  : wrapModule.adapters

const publicBaseUrl = process.env.GLOVEBOX_PUBLIC_URL

await startGlovebox({
  app,
  port,
  key,
  manifestPath: new URL("./glovebox.json", import.meta.url).pathname,
  adapters,
  publicBaseUrl,
})
`

const PACKAGE_JSON = (appName: string, dependencies: Record<string, string>) => ({
  name: `${appName}-server`,
  version: "0.0.0",
  private: true,
  type: "module",
  main: "index.js",
  dependencies,
})

/**
 * Bare specifiers esbuild left unresolved in the emitted bundle.
 *
 * Read from the metafile rather than from the external list, because the two
 * are not the same set: the list is everything that MAY stay out, the metafile
 * is what actually did. Node builtins are filtered — `node:fs` is external in
 * every bundle and is nobody's dependency.
 */
function externalImports(metafile: Metafile, outfile: string): string[] {
  const key = Object.keys(metafile.outputs).find((k) => path.resolve(k) === path.resolve(outfile))
  const imports = key ? (metafile.outputs[key]?.imports ?? []) : []
  const names = new Set<string>()
  for (const imp of imports) {
    if (!imp.external) continue
    const spec = imp.path
    if (spec.startsWith("node:") || spec.startsWith(".") || path.isAbsolute(spec)) continue
    names.add(packageNameOf(spec))
  }
  return [...names].sort()
}

export async function emitServerBundle(args: ServerBundleArgs): Promise<ServerBundleResult> {
  const { wrapEntry, outDir, appName, sqliteFromBaseImage } = args

  if (!existsSync(wrapEntry)) {
    throw new Error(`Wrap entry not found: ${wrapEntry}`)
  }

  await mkdir(outDir, { recursive: true })

  // Resolve `glovebox-kit`'s entry relative to *this* package's install so
  // users only need to depend on `glovebox`. The user's wrap entry is
  // referenced by absolute path; esbuild handles its imports (glove-core,
  // glovebox) through the user's project's node_modules.
  let kitEntry: string
  try {
    kitEntry = requireFromHere.resolve("glovebox-kit")
  } catch {
    throw new Error(
      "Could not resolve glovebox-kit from the glovebox install. Make sure glovebox-kit is installed (it's a dep of glovebox).",
    )
  }
  const entryContents = SYNTHETIC_ENTRY(wrapEntry, kitEntry)
  const outfile = path.join(outDir, "index.js")
  const resolveDir = path.dirname(wrapEntry)

  const result = await esbuild({
    stdin: {
      contents: entryContents,
      resolveDir,
      sourcefile: "synthetic-entry.ts",
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: externalPatterns(),
    metafile: true,
    // Mark the dynamic-import-only paths so esbuild doesn't choke if user's
    // wrap module pulls in optional providers (anthropic, openai, bedrock).
    logLevel: "error",
    banner: {
      // ESM in Node sometimes needs createRequire for transitive CJS modules.
      js: `import { createRequire as __glb_createRequire } from "node:module";\nconst require = __glb_createRequire(import.meta.url);`,
    },
  })

  const staged = await stageExternals({
    used: externalImports(result.metafile, outfile),
    resolveDir,
    outDir,
  })

  const dependencies = serverDependencies(staged.dependencies, { sqliteFromBaseImage, resolveDir })

  await writeFile(
    path.join(outDir, "package.json"),
    JSON.stringify(PACKAGE_JSON(appName, dependencies), null, 2) + "\n",
  )

  return { ...staged, dependencies }
}
