/**
 * Wrap-time configuration for a Glovebox app.
 *
 * The developer hands one of these to `glovebox.wrap(runnable, config)` and
 * the build CLI consumes it to emit a Dockerfile, nixpacks.toml, server
 * bundle, manifest, and auth key.
 */

import type { StoragePolicyEncoded } from "./protocol"

export type BaseImage =
  | "glovebox/base"
  | "glovebox/media"
  | "glovebox/docs"
  | "glovebox/python"
  | "glovebox/browser"
  | (string & {})

export interface FsMount {
  path: string
  writable: boolean
}

export interface EnvVarSpec {
  required: boolean
  secret?: boolean
  default?: string
  description?: string
}

export interface Limits {
  cpu?: string
  memory?: string
  timeout?: string
}

export interface PackageSpec {
  apt?: string[]
  pip?: string[]
  npm?: string[]
}

/**
 * Storage policy entry. Either passed as a typed `StoragePolicyEncoded` shape
 * (post-encoding) or as a fluent `StorageRule[]` constructed with the
 * `rule.*` helpers from `glovebox/storage`.
 */
export type StoragePolicy = StoragePolicyEncoded | { __rules: StoragePolicyEncoded["rules"] }

export interface GloveboxConfig {
  /** Display name for the app, defaults to the package directory name. */
  name?: string
  /** Semver. Defaults to "0.1.0". */
  version?: string
  /** Base image to extend. Defaults to "glovebox/base". */
  base?: BaseImage
  /** Extra system or language packages to install on top of the base. */
  packages?: PackageSpec
  /** Filesystem mounts inside the container. */
  fs?: Record<string, FsMount>
  /** Declared environment variables. The runtime validates these on boot. */
  env?: Record<string, EnvVarSpec>
  /** Storage policies for inputs (client → server) and outputs (server → client). */
  storage?: {
    inputs?: StoragePolicy
    outputs?: StoragePolicy
  }
  /** Resource limits and timeout. Surfaced to the agent via the `environment` skill. */
  limits?: Limits
}

/**
 * Opaque marker type returned by `glovebox.wrap`. The runtime introspects this
 * to discover the runnable and the resolved config.
 */
export interface GloveboxApp {
  readonly __glovebox: 1
  readonly runnable: unknown
  readonly config: ResolvedGloveboxConfig
}

export interface ResolvedGloveboxConfig {
  name: string
  version: string
  base: string
  packages: PackageSpec
  fs: Record<string, FsMount>
  env: Record<string, EnvVarSpec>
  storage: {
    inputs: StoragePolicyEncoded
    outputs: StoragePolicyEncoded
  }
  limits: Limits
}

export const DEFAULT_FS: Record<string, FsMount> = {
  work: { path: "/work", writable: true },
  input: { path: "/input", writable: false },
  output: { path: "/output", writable: true },
}

export const DEFAULT_INPUTS_POLICY: StoragePolicyEncoded = {
  rules: [
    { use: { adapter: "url" }, when: { always: true } },
    { use: { adapter: "inline" }, when: { default: true } },
  ],
}

export const DEFAULT_OUTPUTS_POLICY: StoragePolicyEncoded = {
  rules: [
    { use: { adapter: "inline" }, when: { sizeBelow: "1MB" } },
    { use: { adapter: "localServer", options: { ttl: "1h" } }, when: { default: true } },
  ],
}
