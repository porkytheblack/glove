import { existsSync } from "node:fs"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * The server bundle dropped into `dist/server/` is intentionally tiny: a
 * single `index.js` that imports the developer's wrap module and hands it to
 * `glovebox-kit`. The user wrap module is copied alongside.
 *
 * We don't try to bundle/transpile here. Production deploys run TypeScript
 * via `tsx` or pre-compile the user's source. v1 expects the wrap entry to
 * be a `.js` or `.mjs` file (or compiled output of a `.ts` build step the
 * user owns).
 */
export interface ServerBundleArgs {
  /** Absolute path to the developer's wrap module (the file passed to `glovebox build`). */
  wrapEntry: string
  /** Output directory for the bundle (e.g. `dist/server`). */
  outDir: string
  /** Name field of the developer's app. */
  appName: string
}

const PACKAGE_JSON_TEMPLATE = (appName: string) => ({
  name: `${appName}-server`,
  version: "0.0.0",
  private: true,
  type: "module",
  main: "index.js",
  dependencies: {
    "glovebox-kit": "^0.1.0",
  },
})

const ENTRY_TEMPLATE = `import { startGlovebox } from "glovebox-kit"
import app from "./wrap.js"

const port = Number(process.env.GLOVEBOX_PORT ?? 8080)
const key = process.env.GLOVEBOX_KEY
if (!key) {
  console.error("GLOVEBOX_KEY is required")
  process.exit(1)
}

await startGlovebox({
  app,
  port,
  key,
  manifestPath: new URL("./glovebox.json", import.meta.url).pathname,
})
`

export async function emitServerBundle(args: ServerBundleArgs): Promise<void> {
  const { wrapEntry, outDir, appName } = args

  await mkdir(outDir, { recursive: true })

  if (!existsSync(wrapEntry)) {
    throw new Error(`Wrap entry not found: ${wrapEntry}`)
  }

  const wrapSource = await readFile(wrapEntry)
  const wrapExt = path.extname(wrapEntry)
  const wrapTarget = path.join(outDir, wrapExt === ".ts" ? "wrap.ts" : "wrap.js")
  await writeFile(wrapTarget, wrapSource)

  await writeFile(path.join(outDir, "index.js"), ENTRY_TEMPLATE)

  await writeFile(
    path.join(outDir, "package.json"),
    JSON.stringify(PACKAGE_JSON_TEMPLATE(appName), null, 2) + "\n",
  )
}
