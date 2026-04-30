import type { ResolvedGloveboxConfig } from "../config"

const BASE_IMAGE_REGISTRY = "ghcr.io/dterminal"

const KNOWN_BASE_TAGS: Record<string, string> = {
  "glovebox/base": "1.0",
  "glovebox/media": "1.4",
  "glovebox/docs": "1.2",
  "glovebox/python": "1.3",
  "glovebox/browser": "1.1",
}

export function resolveBaseImage(base: string): string {
  if (base.includes(":") || base.includes("/") && !base.startsWith("glovebox/")) {
    return base
  }
  const tag = KNOWN_BASE_TAGS[base] ?? "latest"
  return `${BASE_IMAGE_REGISTRY}/${base}:${tag}`
}

export function generateDockerfile(config: ResolvedGloveboxConfig): string {
  const baseImage = resolveBaseImage(config.base)
  const apt = config.packages.apt ?? []
  const pip = config.packages.pip ?? []
  const npm = config.packages.npm ?? []

  const lines: string[] = []
  lines.push(`FROM ${baseImage} AS base`)
  lines.push("")

  if (apt.length > 0) {
    lines.push("USER root")
    lines.push("RUN apt-get update && apt-get install -y --no-install-recommends \\")
    lines.push(`    ${apt.join(" \\\n    ")} \\`)
    lines.push(" && rm -rf /var/lib/apt/lists/*")
    lines.push("")
  }

  if (pip.length > 0) {
    lines.push(`RUN pip install --no-cache-dir ${pip.join(" ")}`)
    lines.push("")
  }

  if (npm.length > 0) {
    lines.push(`RUN npm install -g ${npm.join(" ")}`)
    lines.push("")
  }

  // Filesystem layout
  const mountLines: string[] = []
  for (const mount of Object.values(config.fs)) {
    mountLines.push(`mkdir -p ${mount.path}`)
  }

  lines.push("RUN useradd -m -u 10001 glovebox || true \\")
  lines.push(` && ${mountLines.join(" \\\n && ")} \\`)
  for (const mount of Object.values(config.fs)) {
    if (mount.writable) {
      lines.push(` && chown glovebox:glovebox ${mount.path} \\`)
    } else {
      lines.push(` && chown root:root ${mount.path} && chmod 555 ${mount.path} \\`)
    }
  }
  // strip trailing backslash on last line
  const last = lines.length - 1
  lines[last] = lines[last]!.replace(/ \\$/, "")
  lines.push("")

  lines.push("COPY --chown=glovebox:glovebox server /opt/glovebox-server")
  lines.push("WORKDIR /opt/glovebox-server")
  lines.push("RUN cd /opt/glovebox-server && npm ci --omit=dev")
  lines.push("")
  lines.push("USER glovebox")
  lines.push("EXPOSE 8080")
  lines.push('ENV GLOVEBOX_PORT=8080')
  lines.push('CMD ["node", "index.js"]')
  lines.push("")

  return lines.join("\n")
}
