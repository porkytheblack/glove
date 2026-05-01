#!/usr/bin/env node
/**
 * `glovebox` CLI.
 *
 *     glovebox build ./glovebox.ts
 *     glovebox build ./glovebox.ts --out ./dist --name my-app
 */

import path from "node:path"
import process from "node:process"

import { build } from "./build/index"

interface ParsedArgs {
  command: string | undefined
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0]
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next && !next.startsWith("--")) {
          flags[a.slice(2)] = next
          i++
        } else {
          flags[a.slice(2)] = true
        }
      }
    } else {
      positional.push(a)
    }
  }
  return { command, positional, flags }
}

const HELP = `glovebox — build and ship sandboxed Glove agents

Usage:
  glovebox build <entry> [--out <dir>] [--name <name>]

Commands:
  build    Compile a wrap module into a deployable artifact (Dockerfile,
           nixpacks.toml, server bundle, manifest, key).
`

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.command || args.command === "help" || args.flags.help) {
    process.stdout.write(HELP)
    process.exit(0)
  }

  if (args.command === "build") {
    const entry = args.positional[0]
    if (!entry) {
      console.error("error: missing entry path")
      console.error("usage: glovebox build <entry>")
      process.exit(1)
    }
    const outDir = typeof args.flags.out === "string" ? args.flags.out : undefined
    const name = typeof args.flags.name === "string" ? args.flags.name : undefined

    const result = await build({ entry, outDir, name })

    const out = result.outDir
    const rel = path.relative(process.cwd(), out) || out
    process.stdout.write(`✓ Resolved base image: ${result.baseImage}\n`)
    process.stdout.write(
      `✓ Resolved packages (${result.packages.apt} apt, ${result.packages.pip} pip, ${result.packages.npm} npm)\n`,
    )
    process.stdout.write("✓ Generated Dockerfile\n")
    process.stdout.write("✓ Generated nixpacks.toml\n")
    process.stdout.write("✓ Generated server bundle\n")
    process.stdout.write(`✓ Generated auth key (fingerprint: ${result.keyFingerprint})\n`)
    process.stdout.write(`✓ Wrote ${rel}/\n\n`)
    process.stdout.write(`Next:\n`)
    process.stdout.write(
      `  GLOVEBOX_KEY=$(cat ${rel}/glovebox.key) docker run -p 8080:8080 -e GLOVEBOX_KEY <image>\n`,
    )
    return
  }

  console.error(`unknown command: ${args.command}`)
  process.stderr.write(HELP)
  process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
