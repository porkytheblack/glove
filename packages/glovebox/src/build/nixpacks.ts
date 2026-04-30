import type { ResolvedGloveboxConfig } from "../config"

/**
 * Generate a nixpacks.toml that yields the same end-state as the Dockerfile.
 * The server bundle is already self-contained (esbuild output); only native
 * modules need install.
 */
export function generateNixpacks(config: ResolvedGloveboxConfig): string {
  const apt = config.packages.apt ?? []
  const pip = config.packages.pip ?? []
  const npm = config.packages.npm ?? []

  const nixPkgs = ["nodejs_20", ...apt]
  if (pip.length > 0) {
    nixPkgs.push("python311")
    for (const p of pip) nixPkgs.push(`python311Packages.${p}`)
  }

  const lines: string[] = []
  lines.push("[phases.setup]")
  lines.push(`nixPkgs = ${JSON.stringify(nixPkgs)}`)
  lines.push("")
  lines.push("[phases.install]")
  lines.push(`cmds = ["cd server && npm install --omit=dev --no-package-lock"]`)
  lines.push("")
  if (npm.length > 0) {
    lines.push("[phases.build]")
    lines.push(`cmds = [${JSON.stringify(`npm install -g ${npm.join(" ")}`)}]`)
    lines.push("")
  }
  lines.push("[start]")
  lines.push(`cmd = "node server/index.js"`)
  lines.push("")
  lines.push("[variables]")
  lines.push(`GLOVEBOX_PORT = "8080"`)
  lines.push("")
  return lines.join("\n")
}
