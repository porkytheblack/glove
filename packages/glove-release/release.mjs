#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageDirectory, "../..");
const rootManifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
);

if (rootManifest.name !== "glove-monorepo") {
  console.error("release: could not identify the Glove repository root");
  process.exit(1);
}

if (resolve(process.cwd()) !== repositoryRoot) {
  console.error("release: run `npx release` from the Glove repository root");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx release [--check]

Publishes every versioned package described by the pending Changesets.

  --check  Run the npm version preflight without building or publishing.

Run this command from a clean Glove repository root after merging the
Changesets version PR. npm authentication and any required 2FA stay with the
maintainer.`);
  process.exit(0);
}

const unknownArgs = args.filter((arg) => arg !== "--check");
if (unknownArgs.length > 0) {
  console.error(`release: unknown option ${unknownArgs.join(" ")}`);
  process.exit(1);
}

function git(...gitArgs) {
  return spawnSync("git", gitArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

if (!args.includes("--check")) {
  const branch = git("branch", "--show-current");
  if (branch.error || branch.status !== 0) {
    console.error("release: could not read the current Git branch");
    process.exit(1);
  }
  if (branch.stdout.trim() !== "main") {
    console.error("release: publishing is only allowed from the main branch");
    process.exit(1);
  }

  const status = git("status", "--porcelain");
  if (status.error || status.status !== 0) {
    console.error("release: could not inspect the Git worktree");
    process.exit(1);
  }
  if (status.stdout.trim()) {
    console.error("release: publishing requires a clean Git worktree");
    process.exit(1);
  }
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const script = args.includes("--check") ? "check:release" : "release";
const result = spawnSync(command, ["run", script], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(`release: failed to start pnpm: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
