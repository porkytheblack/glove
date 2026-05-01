import type { ResolvedGloveboxConfig } from "../config"

const DEFAULT_BASE_IMAGE_REGISTRY = "ghcr.io/porkytheblack"

const KNOWN_BASE_TAGS: Record<string, string> = {
  "glovebox/base": "1.0",
  "glovebox/media": "1.4",
  "glovebox/docs": "1.2",
  "glovebox/python": "1.3",
  "glovebox/browser": "1.1",
}

/**
 * The set of base-image identifiers that already provide:
 *   - the `glovebox` user (uid 10001)
 *   - the standard /work, /input, /output, /var/glovebox layout
 *   - pre-built better-sqlite3 in /opt/glovebox-prebuilt/node_modules
 *
 * For these images, the generated per-app Dockerfile skips the user/layout
 * setup and links the prebuilt native modules into the server bundle's
 * node_modules instead of running `npm install`.
 */
const STANDARD_GLOVEBOX_BASES = new Set([
  "glovebox/base",
  "glovebox/media",
  "glovebox/docs",
  "glovebox/python",
  "glovebox/browser",
])

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

export function generateDockerfile(config: ResolvedGloveboxConfig): string {
  const baseImage = resolveBaseImage(config.base)
  const isStandardBase = STANDARD_GLOVEBOX_BASES.has(config.base)
  const apt = config.packages.apt ?? []
  const pip = config.packages.pip ?? []
  const npm = config.packages.npm ?? []

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
  if (!isStandardBase) {
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

  if (isStandardBase) {
    // Reuse the prebuilt better-sqlite3 baked into the base image. Faster
    // and avoids needing a C toolchain in the final layer.
    lines.push("RUN mkdir -p node_modules \\")
    lines.push(" && ln -sfn /opt/glovebox-prebuilt/node_modules/better-sqlite3 node_modules/better-sqlite3")
  } else {
    lines.push("RUN npm install --omit=dev --no-package-lock --no-audit --no-fund")
  }
  lines.push("")

  if (needsRoot) {
    lines.push("USER glovebox")
    lines.push("")
  }

  lines.push("EXPOSE 8080")
  lines.push('ENV GLOVEBOX_PORT=8080')
  lines.push('CMD ["node", "index.js"]')
  lines.push("")

  return lines.join("\n")
}
