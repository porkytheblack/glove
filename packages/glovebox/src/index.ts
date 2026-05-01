/**
 * Authoring entry point for Glovebox apps.
 *
 *     import { glovebox, rule, composite } from "glovebox"
 *     import { agent } from "./my-agent"
 *
 *     export default glovebox.wrap(agent, {
 *       base: "glovebox/media",
 *       packages: { apt: ["ffmpeg"] },
 *       storage: {
 *         outputs: composite([rule.inline({ below: "1MB" }), rule.localServer({ ttl: "1h" })]),
 *       },
 *     })
 */

import {
  DEFAULT_FS,
  DEFAULT_INPUTS_POLICY,
  DEFAULT_OUTPUTS_POLICY,
  type GloveboxApp,
  type GloveboxConfig,
  type ResolvedGloveboxConfig,
} from "./config"
import type { StoragePolicy } from "./config"
import type { StoragePolicyEncoded } from "./protocol"

export * from "./config"
export * from "./protocol"
export * from "./storage"

function resolvePolicy(p: StoragePolicy | undefined, fallback: StoragePolicyEncoded): StoragePolicyEncoded {
  if (!p) return fallback
  if ("__rules" in p) return { rules: p.__rules }
  return p
}

function resolve(config: GloveboxConfig): ResolvedGloveboxConfig {
  return {
    name: config.name ?? "glovebox-app",
    version: config.version ?? "0.1.0",
    base: config.base ?? "glovebox/base",
    packages: config.packages ?? {},
    fs: config.fs ?? DEFAULT_FS,
    env: config.env ?? {},
    storage: {
      inputs: resolvePolicy(config.storage?.inputs, DEFAULT_INPUTS_POLICY),
      outputs: resolvePolicy(config.storage?.outputs, DEFAULT_OUTPUTS_POLICY),
    },
    limits: config.limits ?? {},
  }
}

/**
 * Wrap a built Glove runnable into a deployable Glovebox app.
 *
 * The returned object is opaque from the developer's perspective. At runtime
 * (inside the container), `glovebox-kit` reads it to discover the runnable
 * and the resolved config, then injects glovebox-flavored skills, hooks, and
 * mentions on top.
 */
function wrap<R>(runnable: R, config: GloveboxConfig = {}): GloveboxApp {
  return {
    __glovebox: 1,
    runnable,
    config: resolve(config),
  }
}

export const glovebox = { wrap }
