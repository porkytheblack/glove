import { readdir } from "node:fs/promises"
import path from "node:path"

import type { IGloveRunnable } from "glove-core"
import type { ResolvedGloveboxConfig } from "glovebox-core"

/**
 * Per-request state used by the injected hooks. The kit assigns one before
 * invoking the agent and reads it back to learn which extra paths the agent
 * explicitly scheduled for exfiltration.
 */
export interface RequestExfilState {
  /** Absolute paths the agent explicitly tagged for output. */
  extraOutputs: Set<string>
}

/**
 * Inject the standard glovebox-flavored skills, hooks, and mentions onto a
 * runnable. Returns the same runnable for chaining.
 */
export function applyInjections(
  runnable: IGloveRunnable,
  config: ResolvedGloveboxConfig,
  resolveExfilState: () => RequestExfilState | undefined,
): IGloveRunnable {
  // ─── environment skill ────────────────────────────────────────────────
  runnable.defineSkill({
    name: "environment",
    description: "Inspect the live glovebox environment (paths, packages, limits).",
    exposeToAgent: true,
    async handler() {
      const fs: Record<string, { path: string; writable: boolean }> = {}
      for (const [k, v] of Object.entries(config.fs)) fs[k] = v
      return JSON.stringify(
        {
          name: config.name,
          version: config.version,
          base: config.base,
          fs,
          packages: config.packages,
          limits: config.limits,
        },
        null,
        2,
      )
    },
  })

  // ─── workspace skill ──────────────────────────────────────────────────
  runnable.defineSkill({
    name: "workspace",
    description: "List current contents of /work, /input, and /output.",
    exposeToAgent: true,
    async handler() {
      const entries: Record<string, string[]> = {}
      for (const [name, mount] of Object.entries(config.fs)) {
        try {
          entries[name] = await readdir(mount.path)
        } catch {
          entries[name] = []
        }
      }
      return JSON.stringify(entries, null, 2)
    },
  })

  // ─── /output hook ─────────────────────────────────────────────────────
  runnable.defineHook("output", async (ctx) => {
    const state = resolveExfilState()
    const target = ctx.parsedText.trim()
    if (state && target) {
      state.extraOutputs.add(path.resolve(target))
    }
    return { rewriteText: "" }
  })

  // ─── /clear-workspace hook ────────────────────────────────────────────
  runnable.defineHook("clear-workspace", async () => {
    const work = config.fs.work?.path
    if (!work) return { rewriteText: "" }
    try {
      const items = await readdir(work)
      const { rm } = await import("node:fs/promises")
      for (const item of items) {
        await rm(path.join(work, item), { recursive: true, force: true })
      }
    } catch {
      // best effort
    }
    return { rewriteText: "" }
  })

  return runnable
}

/**
 * Build the static environment preamble prepended to the system prompt at
 * boot. Per-request inputs are NOT listed here — the agent calls the
 * `workspace` skill to read the live `/input` directory if it needs to.
 */
export function buildEnvironmentBlock(config: ResolvedGloveboxConfig): string {
  const lines: string[] = []
  lines.push("[Glovebox environment]")
  if (config.fs.work) lines.push(`Working directory: ${config.fs.work.path}`)
  if (config.fs.input) lines.push(`Inputs (read-only): ${config.fs.input.path}`)
  if (config.fs.output) lines.push(`Outputs: ${config.fs.output.path} — write your results here`)
  const apt = config.packages.apt ?? []
  if (apt.length > 0) lines.push(`Available tools: ${apt.join(", ")}`)
  if (config.limits.timeout) lines.push(`Timeout: ${config.limits.timeout}`)
  if (config.limits.memory) lines.push(`Memory limit: ${config.limits.memory}`)
  lines.push("Use the `workspace` skill to list current files in /input, /work, /output.")
  return lines.join("\n")
}
