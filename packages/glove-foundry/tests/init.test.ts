import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { useInteractiveInit } from "../src/init.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[], cwd: string) => execute(process.execPath, ["--import", import.meta.resolve("tsx"), cli, ...args], { cwd, timeout: 30_000 });

test("wizard policy is explicit and never prompts on piped input", () => {
  assert.equal(useInteractiveInit({}, true), true);
  assert.equal(useInteractiveInit({}, false), false);
  assert.equal(useInteractiveInit({ yes: true }, true), false);
  assert.equal(useInteractiveInit({ "no-interactive": true }, true), false);
  assert.equal(useInteractiveInit({ interactive: true }, true), true);
  assert.throws(() => useInteractiveInit({ interactive: true }, false), /needs a terminal/);
  assert.throws(() => useInteractiveInit({ interactive: true, yes: true }, true), /cannot be combined/);
  assert.throws(() => useInteractiveInit({ interactive: true, "no-interactive": true }, true), /cannot be combined/);
});

test("non-interactive CLI creates selected starter without installing or prompting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-init-cli-"));
  try {
    const { stdout } = await run(["init", "selected", "--yes", "--template", "minimal", "--package-manager", "npm", "--no-install"], directory);
    const project = join(directory, "selected");
    assert.match(stdout, /Template: minimal/);
    assert.match(stdout, /npm run dev/);
    assert.doesNotMatch(stdout, /Choose your starting point/);
    const manifest = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
    assert.equal(manifest.scripts.dev, "glove foundry dev");
    await access(join(project, "agents/assistant/agent.ts"));
    await assert.rejects(access(join(project, "node_modules")));
    const readme = await readFile(join(project, "README.md"), "utf8");
    assert.match(readme, /OPENROUTER_API_KEY/);
    assert.match(readme, /persist|durable/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("piped default setup and help finish without a terminal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-init-pipe-"));
  try {
    const help = await run(["init", "--help"], directory);
    assert.match(help.stdout, /--no-interactive/);
    assert.match(help.stdout, /--install/);
    assert.match(help.stdout, /--no-watch/);
    await run(["init", "guided", "--no-install"], directory);
    await access(join(directory, "guided/agents/concierge/agent.ts"));
    await assert.rejects(access(join(directory, "guided/node_modules")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid options and forced interactive pipes fail before creating files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "foundry-init-invalid-"));
  try {
    for (const flags of [["--interactive"], ["--template", "missing"], ["--unknown"], ["--install", "--no-install"], ["--yes", "--interactive"]]) {
      await assert.rejects(run(["init", "untouched", ...flags], directory), (error: unknown) => {
        const failure = error as Error & { code: number; stderr: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr, /usage/);
        assert.doesNotMatch(failure.stderr, /at create/);
        return true;
      });
      await assert.rejects(access(join(directory, "untouched")));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
