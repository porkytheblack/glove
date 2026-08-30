import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A scaffolded project must depend on the same Glove packages this Foundry was
 * built against. Pinning them by hand drifts: `glove-foundry@0.1.0` requires
 * `glove-js@0.4.0`, and a template that asked for `^0.3.0` made npm install a
 * second, structurally different copy of every REPL session class. The project
 * then failed `tsc` on its first run, before the author had written a line.
 *
 * pnpm rewrites `workspace:*` to a concrete version when it publishes, so the
 * installed manifest already states the exact answer. Read it rather than
 * repeating it.
 */

/** Packages a generated project may depend on, resolved from our own manifest. */
export const TEMPLATE_DEPENDENCIES = [
  "effect",
  "glove-core",
  "glove-js",
  "glove-lisp",
  "glove-mcp",
  "glove-memory",
  "glove-python",
  "glove-working-environment",
  "zod",
] as const;

export type TemplateDependency = (typeof TEMPLATE_DEPENDENCIES)[number];

/**
 * Used only when the manifest cannot be read at all — a corrupted install, or a
 * consumer bundling the scaffold away from its own package.json. Running from a
 * monorepo checkout still reads the manifest; it just finds `workspace:*`.
 */
const FALLBACK_RANGES: Readonly<Record<TemplateDependency, string>> = Object.freeze({
  effect: "^3.22.1",
  "glove-core": "^3.6.0",
  "glove-js": "^0.4.0",
  "glove-lisp": "^0.4.0",
  "glove-mcp": "^1.1.0",
  "glove-memory": "^1.1.0",
  "glove-python": "^0.3.0",
  "glove-working-environment": "^0.6.0",
  zod: "^4.3.6",
});

/** The version to request when our own manifest has none worth quoting. */
const FALLBACK_FOUNDRY_RANGE = "^0.1.0";

interface Manifest {
  readonly version?: unknown;
  readonly dependencies?: Readonly<Record<string, unknown>>;
}

export interface FoundryTemplateVersions {
  /** Range for `glove-foundry` itself. */
  readonly foundry: string;
  /** Ranges for every package a template may reference. */
  readonly dependencies: Readonly<Record<TemplateDependency, string>>;
  /** True only when every range came from the manifest, not the fallback table. */
  readonly resolved: boolean;
  /** Packages that fell back, so a caller can say which are worth checking. */
  readonly fellBack: ReadonlyArray<TemplateDependency>;
}

/**
 * `workspace:*` and friends only appear in a monorepo checkout; a published
 * install always carries a real range. Caret-prefix a bare version so a
 * generated project still picks up patch releases.
 */
function toRange(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("workspace:") || value.startsWith("link:") || value.startsWith("file:")) {
    return null;
  }
  if (/^[\^~><=]|^\d+\.x|\|\||\s-\s/.test(value)) return value;
  return `^${value}`;
}

async function readOwnManifest(): Promise<Manifest | null> {
  // dist/scaffold-versions.js and src/scaffold-versions.ts both sit one level
  // below the package root, so the same relative path serves built and source.
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
  try {
    return JSON.parse(await readFile(path, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export async function resolveTemplateVersions(): Promise<FoundryTemplateVersions> {
  const manifest = await readOwnManifest();
  const declared = manifest?.dependencies ?? {};
  const dependencies: Record<TemplateDependency, string> = { ...FALLBACK_RANGES };
  const fellBack: TemplateDependency[] = [];
  for (const name of TEMPLATE_DEPENDENCIES) {
    const range = toRange(declared[name]);
    if (range) dependencies[name] = range;
    // A monorepo checkout carries workspace:* here, so the table stands in.
    else fellBack.push(name);
  }
  // A checkout carries the placeholder 0.0.0 that the release process replaces.
  const own = toRange(manifest?.version);
  const foundry = own && own !== "^0.0.0" ? own : FALLBACK_FOUNDRY_RANGE;
  return Object.freeze({
    foundry,
    dependencies: Object.freeze(dependencies),
    resolved: fellBack.length === 0,
    fellBack: Object.freeze(fellBack),
  });
}
