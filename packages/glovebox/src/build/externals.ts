/**
 * What must NOT be inlined into the server bundle, and what to do with it.
 *
 * ## The failure this exists to prevent
 *
 * esbuild produces one file. That is right for ordinary JavaScript and wrong
 * for two kinds of package, both of which the working environment uses:
 *
 * 1. **Packages that spawn or resolve by their own location.**
 *    `glove-working-environment` starts scripts in a worker thread it opens by
 *    URL — `new Worker(new URL("./worker.js", import.meta.url))` — so
 *    `worker.js` has to exist as a real file next to the module that names it.
 *    Inlined, `import.meta.url` becomes the bundle's own path and the probe
 *    finds nothing. Measured, with the whole family inlined:
 *
 *        Error: could not start a script worker after 6 attempts:
 *        glove-working-environment: could not find the script worker entry
 *        next to /opt/glovebox-server/index.js. The package must ship
 *        executor/worker.js as its own file — it is spawned by URL, not
 *        imported.
 *
 *    That surfaces at the FIRST script write, not at build time, which is the
 *    worst possible place to learn it. `glove-env-motion` and
 *    `glove-env-render` fail the same way for the same reason: motion derives
 *    `PKG_ROOT` from `import.meta.url` to find its own React/Babel, and render
 *    does `require.resolve("pdfjs-dist/package.json")` to find pdf.js's font
 *    data. Both answers are wrong once the code lives somewhere else.
 *
 * 2. **Packages with a platform-specific binary.** sharp, @napi-rs/canvas,
 *    better-sqlite3, the ffmpeg/ffprobe installers, playwright-core's browser
 *    registry, esbuild's own child binary. A `.node` or an executable cannot
 *    be JS-bundled at all, and even if the JS shim survives it resolves the
 *    binary at run time relative to its package — which is gone.
 *
 * ## The two answers
 *
 * They need different treatment, and the split is the whole design:
 *
 * - The env family is pure JavaScript, so its exact build is **vendored** into
 *   the artifact (`dist/server/vendor/<name>`) and copied into `node_modules`
 *   in the image. Vendoring, not `npm install`, because the version that was
 *   built against is the version that should run — and a workspace package
 *   that was never published still has to ship.
 * - Native packages are **declared** in the emitted `package.json` and
 *   installed inside the container, where npm picks the binary for the image's
 *   platform rather than the build laptop's.
 *
 * The copy has to happen AFTER `npm install`, not before: npm prunes anything
 * in `node_modules` it did not put there ("added 1 package, and removed 1
 * package"), so a vendored tree staged first is deleted by the install step.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { cp, mkdir } from "node:fs/promises"
import { isBuiltin } from "node:module"
import path from "node:path"

/**
 * Packages whose module identity is load-bearing: they resolve files relative
 * to themselves, or spawn one of their own files as a thread entry.
 *
 * Matched as a prefix so `glove-env-<anything>` is covered without this list
 * needing an edit every time an adapter is added — a new adapter that this
 * file has never heard of is exactly the case that must not silently inline.
 */
export const ENV_FAMILY_ROOTS = ["glove-working-environment", "glove-env-"] as const

/**
 * Packages that ship a platform-specific binary. Installed in the container,
 * never bundled and never vendored from the build host.
 *
 * `esbuild` is here because it shells out to a sibling `@esbuild/<platform>`
 * executable; `playwright-core` because it locates browsers through its own
 * package directory.
 */
export const NATIVE_EXTERNALS = [
  "better-sqlite3",
  "sharp",
  "@napi-rs/canvas",
  "canvas",
  "playwright",
  "playwright-core",
  "@ffmpeg-installer/ffmpeg",
  "@ffprobe-installer/ffprobe",
  "esbuild",
  "onnxruntime-node",
] as const

/** better-sqlite3 is a dependency of glovebox-kit, so every server needs it. */
export const SQLITE = "better-sqlite3"
const SQLITE_FALLBACK_RANGE = "^11.5.0"

/** esbuild `external` entries covering the env family and the native list. */
export function externalPatterns(): string[] {
  const out: string[] = []
  for (const root of ENV_FAMILY_ROOTS) {
    if (root.endsWith("-")) {
      out.push(`${root}*`)
    } else {
      out.push(root, `${root}/*`)
    }
  }
  for (const name of NATIVE_EXTERNALS) out.push(name, `${name}/*`)
  return out
}

export function isEnvFamily(name: string): boolean {
  return ENV_FAMILY_ROOTS.some((root) => (root.endsWith("-") ? name.startsWith(root) : name === root))
}

/** `@scope/pkg/deep/path` → `@scope/pkg`; `pkg/deep` → `pkg`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
}

/**
 * Locate an installed package's root directory.
 *
 * Walks the `node_modules` chain by hand rather than asking a resolver,
 * because both of Node's resolvers refuse the packages that matter most here.
 *
 * `createRequire().resolve()` answers under the **`require`** condition, and
 * the whole env family is ESM-only: an `exports` map with no `require` branch
 * returns ERR_PACKAGE_PATH_NOT_EXPORTED for the entry point *and* for
 * `<name>/package.json`, unless the map happens to list `./package.json`
 * explicitly. Measured against this example's four env packages, exactly one
 * — `glove-env-render`, the only one exporting `./package.json` — resolved.
 * The other three, `glove-working-environment` among them, reported as
 * unresolvable and were left out of the image entirely. Silently shipping an
 * artifact without the hub is precisely the failure #128 is about, so this
 * cannot depend on a package's choice of export map.
 *
 * A directory is all any caller needs: files are copied out of it and the
 * version is read from its manifest. Nothing in this build ever imports the
 * package, so whether its entry point is reachable is beside the point.
 *
 * The result is realpath'd because under pnpm `node_modules/<name>` is a
 * symlink into the store or the workspace, and `cp` does not follow one —
 * copying the link itself would put a dangling symlink in the artifact.
 */
export function resolvePackageDir(name: string, from: string): string | null {
  const segments = name.split("/")
  let dir = path.resolve(from)
  for (;;) {
    const candidate = path.join(dir, "node_modules", ...segments)
    if (existsSync(path.join(candidate, "package.json"))) {
      try {
        return realpathSync(candidate)
      } catch {
        return candidate
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

interface PackageManifest {
  name?: string
  version?: string
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export interface StageArgs {
  /** Bare specifiers esbuild reported as external in the emitted bundle. */
  used: string[]
  /** Directory the wrap module resolves its imports from. */
  resolveDir: string
  /** The server bundle directory (`dist/server`). */
  outDir: string
}

export interface StageResult {
  /** Env-family packages copied into `<outDir>/vendor`, in vendoring order. */
  vendored: string[]
  /** Registry dependencies for the emitted `package.json`. */
  dependencies: Record<string, string>
  /** Externals that could not be resolved on the build host. */
  unresolved: string[]
}

/**
 * Vendor the env family and collect the registry dependencies.
 *
 * Transitive on purpose. A wrap module typically imports `glove-env-render`
 * and never names `glove-working-environment` at all — but render imports it
 * at run time, so the hub has to be vendored even though nothing in the bundle
 * mentions it. Walking each vendored package's own manifest is what finds it.
 */
export async function stageExternals(args: StageArgs): Promise<StageResult> {
  const { used, resolveDir, outDir } = args

  const dependencies: Record<string, string> = {}
  const unresolved: string[] = []
  const vendored: string[] = []
  const seen = new Set<string>()

  /** Record a registry dependency at the version resolved on the build host. */
  const declare = (name: string, from: string, declaredRange?: string): void => {
    if (dependencies[name]) return
    const dir = resolvePackageDir(name, from)
    if (!dir) {
      // Not installed here. If the manifest that asked for it gave a range,
      // honour that — the container's npm can still fetch it.
      if (declaredRange && !declaredRange.startsWith("workspace:")) {
        dependencies[name] = declaredRange
        return
      }
      unresolved.push(name)
      return
    }
    const version = readManifestSync(dir)?.version
    dependencies[name] = version ? `^${version}` : (declaredRange ?? "*")
  }

  const queue: Array<{ name: string; from: string }> = []
  for (const specifier of used) {
    const name = packageNameOf(specifier)
    // Node's own modules are in the image by virtue of being Node. Left in,
    // they are wrong in both directions: `fs`, `path` and `crypto` have no
    // package to resolve and were reported to the user as missing installs,
    // while `buffer`, `events` and `https` DO exist on npm as userland shims
    // and happened to be installed here as somebody's transitive dependency —
    // so they were resolved and written into the server's package.json,
    // making the image install a polyfill that shadows the real builtin.
    // `isBuiltin` covers both the bare and `node:`-prefixed spellings.
    if (isBuiltin(specifier) || isBuiltin(name)) continue
    if (isEnvFamily(name)) queue.push({ name, from: resolveDir })
    else declare(name, resolveDir)
  }

  await mkdir(path.join(outDir, "vendor"), { recursive: true })

  while (queue.length > 0) {
    const { name, from } = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)

    const dir = resolvePackageDir(name, from)
    if (!dir) {
      unresolved.push(name)
      continue
    }
    const manifest = readManifestSync(dir)
    if (!manifest) {
      unresolved.push(name)
      continue
    }

    await copyPackage(dir, path.join(outDir, "vendor", ...name.split("/")), manifest)
    vendored.push(name)

    // Its own dependencies become the container's problem: env-family ones are
    // vendored beside it, everything else is installed from the registry.
    const required: Array<[string, string]> = [...Object.entries(manifest.dependencies ?? {})]
    for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[dep]?.optional) continue
      required.push([dep, range])
    }
    for (const [dep, range] of required) {
      if (isEnvFamily(dep)) queue.push({ name: dep, from: dir })
      else declare(dep, dir, range)
    }
  }

  // Native packages never get vendored even when an env package depends on
  // them — the build host's binary is for the build host's platform.
  for (const name of NATIVE_EXTERNALS) {
    if (vendored.includes(name)) throw new Error(`internal: refused to vendor native package ${name}`)
  }

  return { vendored, dependencies, unresolved }
}

function readManifestSync(dir: string): PackageManifest | null {
  const p = path.join(dir, "package.json")
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PackageManifest
  } catch {
    return null
  }
}

/**
 * Copy a package into the artifact, honouring its `files` allowlist.
 *
 * The allowlist is what makes this cheap: every package in the env family
 * publishes `"files": ["dist"]`, so the vendored copy is the built output and
 * the manifest — not the sources, tests, and (crucially) not a `node_modules`
 * full of the build host's binaries.
 */
async function copyPackage(src: string, dest: string, manifest: PackageManifest): Promise<void> {
  await mkdir(dest, { recursive: true })
  await cp(path.join(src, "package.json"), path.join(dest, "package.json"))

  const entries = manifest.files?.length ? manifest.files : null
  if (!entries) {
    await cp(src, dest, {
      recursive: true,
      filter: (from) => path.basename(from) !== "node_modules" && path.basename(from) !== ".git",
    })
    return
  }
  for (const entry of entries) {
    // `files` may name globs; the env family uses plain directory names, and a
    // glob here would be a package we have not seen — copy what exists and let
    // a genuinely missing entry surface as a resolution error, not a crash.
    const fromPath = path.join(src, entry)
    if (!existsSync(fromPath)) continue
    const toPath = path.join(dest, entry)
    await mkdir(path.dirname(toPath), { recursive: true })
    await cp(fromPath, toPath, {
      recursive: statSync(fromPath).isDirectory(),
      filter: (from) => path.basename(from) !== "node_modules",
    })
  }
}

/**
 * The dependency block for the emitted server `package.json`.
 *
 * better-sqlite3 is glovebox-kit's own and therefore unconditional — except on
 * a standard base image, which already carries a compiled copy in
 * /opt/glovebox-prebuilt and links it in rather than paying a rebuild.
 */
export function serverDependencies(
  discovered: Record<string, string>,
  opts: { sqliteFromBaseImage: boolean; resolveDir: string },
): Record<string, string> {
  const deps = { ...discovered }
  if (opts.sqliteFromBaseImage) {
    delete deps[SQLITE]
  } else if (!deps[SQLITE]) {
    const dir = resolvePackageDir(SQLITE, opts.resolveDir)
    const version = dir ? readManifestSync(dir)?.version : undefined
    deps[SQLITE] = version ? `^${version}` : SQLITE_FALLBACK_RANGE
  }
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
}
