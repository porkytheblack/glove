// Copy the VAD model + ONNX runtime into public/ so the browser never has to
// reach a CDN for them.
//
// The local VAD is what makes the agent stop talking the instant you do, and
// the adapter's default asset source is jsdelivr. A locked-down network, an
// offline demo, or a slow CDN therefore degraded barge-in to the hand-written
// energy VAD — exactly the fallback that behaves worst in the noisy rooms this
// is meant to survive. These files are already on disk as dependencies;
// serving them ourselves makes the neural path the reliable one.
//
// Not committed: 14MB of binaries reconstructible from node_modules.

import { createRequire } from "node:module";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const out = path.join(import.meta.dirname, "..", "public", "vad");
mkdirSync(out, { recursive: true });

/**
 * Find a package's install directory without relying on `<pkg>/package.json`
 * being exported — onnxruntime-web does not export it, and newer packages
 * increasingly do not. Resolve something the package DOES export, then walk up
 * to the directory that owns it.
 */
function packageRoot(pkg, exportedSubpath) {
  let dir = path.dirname(require.resolve(exportedSubpath ?? pkg));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json")) && dir.endsWith(pkg.replace("/", path.sep))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // Fall back to the nearest directory containing a package.json.
  dir = path.dirname(require.resolve(exportedSubpath ?? pkg));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`cannot locate ${pkg}`);
}

const assets = [
  ["@ricky0123/vad-web", null, "dist/silero_vad_v5.onnx"],
  ["onnxruntime-web", "onnxruntime-web", "dist/ort-wasm-simd-threaded.wasm"],
];

for (const [pkg, exported, rel] of assets) {
  const name = path.basename(rel);
  const dest = path.join(out, name);
  if (existsSync(dest)) continue;
  try {
    copyFileSync(path.join(packageRoot(pkg, exported), rel), dest);
    console.log(`vendored ${name}`);
  } catch (err) {
    // Non-fatal: the adapter falls back to the CDN, and past that to the
    // energy VAD. Say so rather than fail a build over an optimisation.
    console.warn(`could not vendor ${name} — the browser will try the CDN instead:`, err.message);
  }
}
