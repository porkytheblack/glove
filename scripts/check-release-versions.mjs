#!/usr/bin/env node
/**
 * Refuse to publish a version npm already has.
 *
 * `changeset publish` treats an already-published version as "nothing to do"
 * and exits 0, so a repo whose version has drifted *behind* the registry ships
 * silently nothing while its dependants bump against a core that never went
 * out. That is exactly what happened to `glove-working-environment`: the repo
 * said 0.1.0, npm had 0.2.0, and the next release would have been a no-op
 * nobody noticed until an adapter failed to resolve its peer.
 *
 * This runs before the release build. It is a preflight, not a gate on
 * correctness — a package that is simply not published yet is fine and
 * reported as such.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = join(ROOT, "packages");

/** Registry latest for a name, or null when it has never been published. */
async function latestOnNpm(name) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`registry lookup for ${name} failed: ${res.status}`);
  const body = await res.json();
  return body["dist-tags"]?.latest ?? null;
}

/** -1 | 0 | 1 for semver core versions (prerelease tags are compared as strings). */
function cmp(a, b) {
  const parse = (v) => v.split("-")[0].split(".").map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

const problems = [];
const notes = [];

for (const dir of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.private || !pkg.name || !pkg.version) continue;

  let latest;
  try {
    latest = await latestOnNpm(pkg.name);
  } catch (e) {
    notes.push(`? ${pkg.name}: ${e.message}`);
    continue;
  }

  if (latest === null) {
    notes.push(`+ ${pkg.name}@${pkg.version} — first publish`);
    continue;
  }
  const order = cmp(pkg.version, latest);
  if (order < 0) {
    problems.push(
      `${pkg.name}: repo ${pkg.version} is BEHIND npm ${latest}. ` +
        `\`changeset version\` would compute a version npm already has and publish nothing. ` +
        `Set the repo version to at least ${latest} first.`,
    );
  } else if (order === 0) {
    notes.push(`= ${pkg.name}@${pkg.version} — matches npm (changesets will bump it)`);
  } else {
    notes.push(`↑ ${pkg.name}@${pkg.version} — ahead of npm ${latest}`);
  }
}

for (const n of notes) console.log(`  ${n}`);

if (problems.length) {
  console.error(`\nRelease preflight failed:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`);
  process.exit(1);
}
console.log("\nrelease preflight ok — no package is behind the registry");
