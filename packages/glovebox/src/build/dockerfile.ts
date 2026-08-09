import type { ResolvedGloveboxConfig } from "../config"

const DEFAULT_BASE_IMAGE_REGISTRY = "ghcr.io/porkytheblack"

const KNOWN_BASE_TAGS: Record<string, string> = {
  "glovebox/base": "1.0",
  "glovebox/media": "1.4",
  "glovebox/docs": "1.2",
  "glovebox/python": "1.3",
  "glovebox/browser": "1.1",
  "glovebox/studio": "1.0",
}

/**
 * The set of base-image identifiers that already provide:
 *   - the `glovebox` user (uid 10001)
 *   - the standard /work, /input, /output, /var/glovebox layout
 *   - pre-built better-sqlite3 in /opt/glovebox-prebuilt/node_modules
 *
 * For these images, the generated per-app Dockerfile skips the user/layout
 * setup and links the prebuilt native modules into the server bundle's
 * node_modules instead of rebuilding them.
 */
const STANDARD_GLOVEBOX_BASES = new Set([
  "glovebox/base",
  "glovebox/media",
  "glovebox/docs",
  "glovebox/python",
  "glovebox/browser",
  "glovebox/studio",
])

export function isStandardBase(base: string): boolean {
  return STANDARD_GLOVEBOX_BASES.has(base)
}

/**
 * Resolve a `glovebox/<name>` base reference to a fully-qualified registry
 * URL. The registry prefix can be overridden via the `GLOVEBOX_REGISTRY`
 * env var (useful for forks or private mirrors); otherwise it defaults to
 * the public `ghcr.io/porkytheblack` namespace.
 *
 * If the caller passed an explicit reference (e.g. `quay.io/me/img:tag` or
 * `glovebox/media:custom`), it's returned as-is.
 */
export function resolveBaseImage(base: string): string {
  if (base.includes(":") || (base.includes("/") && !base.startsWith("glovebox/"))) {
    return base
  }
  const registry = (process.env.GLOVEBOX_REGISTRY ?? DEFAULT_BASE_IMAGE_REGISTRY).replace(/\/$/, "")
  const tag = KNOWN_BASE_TAGS[base] ?? "latest"
  return `${registry}/${base}:${tag}`
}

/** What `emitServerBundle` left in `dist/server/` for the image to finish. */
export interface BundleLayout {
  /** Registry dependencies in the emitted `package.json`. */
  dependencies: Record<string, string>
  /** Env-family packages staged under `dist/server/vendor/`. */
  vendored: string[]
}

export function generateDockerfile(config: ResolvedGloveboxConfig, bundle: BundleLayout): string {
  const baseImage = resolveBaseImage(config.base)
  const standardBase = isStandardBase(config.base)
  const apt = config.packages.apt ?? []
  const pip = config.packages.pip ?? []
  const npm = config.packages.npm ?? []
  const hasDeps = Object.keys(bundle.dependencies).length > 0
  const hasVendor = bundle.vendored.length > 0

  const lines: string[] = []
  lines.push(`FROM ${baseImage} AS base`)
  lines.push("")

  // Extra packages declared by the wrap config. The base image is always
  // entered as the `glovebox` user; switch to root for installs and back.
  const needsRoot = apt.length > 0 || pip.length > 0 || npm.length > 0
  if (needsRoot) {
    lines.push("USER root")
    lines.push("")
  }

  if (apt.length > 0) {
    lines.push("RUN apt-get update && apt-get install -y --no-install-recommends \\")
    lines.push(`      ${apt.join(" \\\n      ")} \\`)
    lines.push(" && rm -rf /var/lib/apt/lists/*")
    lines.push("")
  }

  if (pip.length > 0) {
    // Standard bases that ship Python (python, media, docs) set
    // PIP_BREAK_SYSTEM_PACKAGES; for others, fall back to a venv.
    lines.push(`RUN pip install --no-cache-dir --break-system-packages ${pip.join(" ")}`)
    lines.push("")
  }

  if (npm.length > 0) {
    lines.push(`RUN npm install -g ${npm.join(" ")}`)
    lines.push("")
  }

  // For non-standard bases, do the user/layout setup ourselves.
  if (!standardBase) {
    const mountLines: string[] = []
    for (const mount of Object.values(config.fs)) {
      mountLines.push(`mkdir -p ${mount.path}`)
    }
    lines.push("RUN useradd -m -u 10001 glovebox || true \\")
    lines.push(` && ${mountLines.join(" \\\n && ")} \\`)
    const ownLines: string[] = []
    for (const mount of Object.values(config.fs)) {
      if (mount.writable) {
        ownLines.push(`chown glovebox:glovebox ${mount.path}`)
      } else {
        ownLines.push(`chown root:root ${mount.path} && chmod 555 ${mount.path}`)
      }
    }
    ownLines.push("mkdir -p /var/glovebox/files")
    ownLines.push("chown -R glovebox:glovebox /var/glovebox")
    lines.push(` && ${ownLines.join(" \\\n && ")}`)
    lines.push("")
  }

  // Copy the esbuild-bundled server.
  lines.push("COPY --chown=glovebox:glovebox server /opt/glovebox-server")
  lines.push("WORKDIR /opt/glovebox-server")
  lines.push("")

  // Registry dependencies first, in their own layer: npm resolves the native
  // binaries for THIS image's platform, which is the whole reason they were
  // kept out of the bundle.
  if (hasDeps) {
    lines.push("RUN npm install --omit=dev --no-package-lock --no-audit --no-fund")
    lines.push("")
  }

  // Everything below has to come after `npm install`, not before: npm prunes
  // anything in node_modules it did not put there, so a linked or vendored
  // tree staged first is deleted by the install.
  const finish: string[] = []
  if (standardBase) {
    // Reuse the prebuilt better-sqlite3 baked into the base image. Faster
    // and avoids needing a C toolchain in the final layer.
    finish.push("ln -sfn /opt/glovebox-prebuilt/node_modules/better-sqlite3 node_modules/better-sqlite3")
  }
  if (hasVendor) {
    // The env family ships as real directories rather than an npm install:
    // these are the exact builds the bundle was compiled against, and a
    // workspace package that was never published has no other way in.
    finish.push("cp -R vendor/. node_modules/")
    finish.push("rm -rf vendor")
  }
  if (finish.length > 0) {
    lines.push(`RUN mkdir -p node_modules \\\n && ${finish.join(" \\\n && ")}`)
    lines.push("")
  }

  if (needsRoot) {
    // node_modules was written by root; hand the tree back to the user the
    // server runs as.
    lines.push("RUN chown -R glovebox:glovebox /opt/glovebox-server")
    lines.push("")
    lines.push("USER glovebox")
    lines.push("")
  }

  lines.push("EXPOSE 8080")
  lines.push('ENV GLOVEBOX_PORT=8080')
  lines.push('CMD ["node", "index.js"]')
  lines.push("")

  return lines.join("\n")
}
