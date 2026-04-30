import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import { build as esbuild } from "esbuild"

const requireFromHere = createRequire(import.meta.url)

/**
 * The server bundle dropped into `dist/server/` is a single ESM file:
 * `index.js`. esbuild inlines glovebox-kit, glovebox, glove-core, and the
 * developer's wrap module. Native binaries (better-sqlite3) stay external
 * because they can't be JS-bundled — they're either provided by the base
 * image or installed via the emitted package.json.
 */
export interface ServerBundleArgs {
  /** Absolute path to the developer's wrap module (the file passed to `glovebox build`). */
  wrapEntry: string
  /** Output directory for the bundle (e.g. `dist/server`). */
  outDir: string
  /** Name field of the developer's app. */
  appName: string
}

/** Native modules that can't be bundled and must be installed at runtime. */
const NATIVE_EXTERNALS = ["better-sqlite3"]

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

const PACKAGE_JSON = (appName: string) => ({
  name: `${appName}-server`,
  version: "0.0.0",
  private: true,
  type: "module",
  main: "index.js",
  dependencies: {
    "better-sqlite3": "^11.5.0",
  },
})

export async function emitServerBundle(args: ServerBundleArgs): Promise<void> {
  const { wrapEntry, outDir, appName } = args

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

  await esbuild({
    stdin: {
      contents: entryContents,
      resolveDir: path.dirname(wrapEntry),
      sourcefile: "synthetic-entry.ts",
      loader: "ts",
    },
    outfile: path.join(outDir, "index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: NATIVE_EXTERNALS,
    // Mark the dynamic-import-only paths so esbuild doesn't choke if user's
    // wrap module pulls in optional providers (anthropic, openai, bedrock).
    logLevel: "error",
    banner: {
      // ESM in Node sometimes needs createRequire for transitive CJS modules.
      js: `import { createRequire as __glb_createRequire } from "node:module";\nconst require = __glb_createRequire(import.meta.url);`,
    },
  })

  await writeFile(
    path.join(outDir, "package.json"),
    JSON.stringify(PACKAGE_JSON(appName), null, 2) + "\n",
  )
}
