#!/usr/bin/env node

// glove-monitor CLI launcher — re-executes itself with tsx as a Node loader
// so user `gmonitor.config.ts` files can be imported at runtime without an
// extra build step. Same pattern as station-kit/src/cli.ts.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { execPath } from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const MARKER = "__GMONITOR_TSX_LOADED"

if (!process.env[MARKER]) {
  // Resolve tsx from glove-monitor's own dependencies (not the user's project)
  const require = createRequire(import.meta.url)
  let tsxSpecifier: string
  try {
    const tsxEntry = require.resolve("tsx")
    tsxSpecifier = pathToFileURL(tsxEntry).href
  } catch {
    tsxSpecifier = "tsx"  // last-resort fallback if user has it installed
  }

  const main = fileURLToPath(new URL("./cli-main.js", import.meta.url))
  const child = spawn(execPath, ["--import", tsxSpecifier, main, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, [MARKER]: "1", __GMONITOR_TSX: tsxSpecifier },
  })
  child.on("exit", (code) => process.exit(code ?? 0))
  child.on("error", (err) => {
    console.error("[glove-monitor] failed to start:", err.message)
    process.exit(1)
  })
} else {
  // Already running under tsx — execute main directly.
  await import("./cli-main.js")
}
