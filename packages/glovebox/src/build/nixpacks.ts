import type { ResolvedGloveboxConfig } from "../config"
import type { BundleLayout } from "./dockerfile"

/**
 * Generate a nixpacks.toml that yields the same end-state as the Dockerfile.
 * The server bundle carries its own JavaScript; what needs installing is the
 * native modules kept out of it, and what needs copying is the vendored env
 * family — in that order, because npm prunes anything in `node_modules` it did
 * not put there.
 */
export function generateNixpacks(config: ResolvedGloveboxConfig, bundle: BundleLayout): string {
  const apt = config.packages.apt ?? []
  const pip = config.packages.pip ?? []
  const npm = config.packages.npm ?? []

  const nixPkgs = ["nodejs_20", ...apt]
  if (pip.length > 0) {
    nixPkgs.push("python311")
    for (const p of pip) nixPkgs.push(`python311Packages.${p}`)
  }

  const install: string[] = []
  if (Object.keys(bundle.dependencies).length > 0) {
    install.push("cd server && npm install --omit=dev --no-package-lock")
  }
  if (bundle.vendored.length > 0) {
    install.push("cd server && mkdir -p node_modules && cp -R vendor/. node_modules/ && rm -rf vendor")
  }
  if (install.length === 0) install.push("cd server && mkdir -p node_modules")

  const lines: string[] = []
  lines.push("[phases.setup]")
  lines.push(`nixPkgs = ${JSON.stringify(nixPkgs)}`)
  lines.push("")
  lines.push("[phases.install]")
  lines.push(`cmds = ${JSON.stringify(install)}`)
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
